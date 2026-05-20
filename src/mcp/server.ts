import { WebSocket } from 'ws';
import { mcpRegistry } from './registry.js';
import { logger } from '../logger.js';

interface MCPClient {
  name: string;
  ws: WebSocket;
  tools: any[];
}

class MCPServerManager {
  private clients: MCPClient[] = [];

  async connect(url: string, name?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        ws.on('open', () => {
          const client: MCPClient = { name: name || url, ws, tools: [] };
          this.clients.push(client);
          logger.info('[MCP] Connected', { name: client.name });
          resolve();
        });
        ws.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleMessage(msg);
          } catch { /* ignore malformed messages */ }
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

  private handleMessage(msg: any) {
    if (msg.type === 'tool_list') {
      const clients = this.clients;
      for (const tool of msg.tools || []) {
        mcpRegistry.register({
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters || {},
          async execute(args: any) {
            const payload = JSON.stringify({ type: 'tool_call', name: tool.name, args });
            const client = clients.find(c => c.ws.readyState === 1);
            if (!client) return 'MCP 服务器不可用';
            return new Promise((resolve) => {
              const handler = (data: Buffer) => {
                try {
                  const resp = JSON.parse(data.toString());
                  if (resp.type === 'tool_result' && resp.name === tool.name) {
                    client.ws.off('message', handler);
                    resolve(resp.result || '');
                  }
                } catch { /* ignore */ }
              };
              client.ws.on('message', handler);
              client.ws.send(payload);
              setTimeout(() => { client.ws.off('message', handler); resolve('MCP 工具调用超时'); }, 30000);
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
