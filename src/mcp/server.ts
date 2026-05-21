import { WebSocket } from 'ws';
import { mcpRegistry } from './registry.js';
import { logger } from '../logger.js';
import { genId } from '../utils.js';

interface MCPClient {
  name: string;
  ws: WebSocket;
  tools: any[];
}

class MCPServerManager {
  private clients: MCPClient[] = [];
  private pendingRequests = new Map<string, { resolve: (v: string) => void; timer: NodeJS.Timeout }>();

  private setupMessageHandler(client: MCPClient) {
    client.ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'tool_result' && msg.req_id) {
          const pending = this.pendingRequests.get(msg.req_id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(msg.req_id);
            pending.resolve(msg.result || '');
            return;
          }
        }
        this.handleMessage(msg, client);
      } catch { /* ignore malformed messages */ }
    });
  }

  async connect(url: string, name?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        ws.on('open', () => {
          const client: MCPClient = { name: name || url, ws, tools: [] };
          this.clients.push(client);
          this.setupMessageHandler(client);
          logger.info('[MCP] Connected', { name: client.name });
          resolve();
        });
        ws.on('close', () => {
          logger.info('[MCP] Disconnected', { name: name || url });
          this.clients = this.clients.filter(c => c.ws !== ws);
        });
        ws.on('error', (err: Error) => {
          logger.error('[MCP] Connection failed', { name: name || url, error: err.message });
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleMessage(msg: any, client: MCPClient) {
    if (msg.type === 'tool_list') {
      for (const tool of msg.tools || []) {
        mcpRegistry.register({
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters || {},
          execute: async (args: any) => {
            const reqId = genId('mcp_req_');
            return new Promise<string>((resolve) => {
              if (client.ws.readyState !== 1) {
                return resolve('MCP 服务器不可用');
              }
              const timer = setTimeout(() => {
                this.pendingRequests.delete(reqId);
                resolve('MCP 工具调用超时');
              }, 30000);
              this.pendingRequests.set(reqId, { resolve, timer });
              client.ws.send(JSON.stringify({ type: 'tool_call', req_id: reqId, name: tool.name, args }));
            });
          },
        });
      }
    }
  }

  disconnectAll() {
    for (const c of this.clients) {
      c.ws.close();
    }
    this.clients = [];
  }
}

export const mcpServerManager = new MCPServerManager();
