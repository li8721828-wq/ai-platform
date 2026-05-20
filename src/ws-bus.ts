import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from './logger.js';

class WsBus {
  private wss!: WebSocketServer;
  private clients = new Set<WebSocket>();
  private validToken: string | null = null;

  setAuthToken(token: string | null) { this.validToken = token; }
  getAuthToken() { return this.validToken; }

  attach(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '', 'http://localhost');
      const token = url.searchParams.get('token');
      if (this.validToken && token !== this.validToken) {
        ws.close(4001, 'unauthorized');
        return;
      }
      this.clients.add(ws);
      logger.info('WS 客户端已连接', { total: this.clients.size });
      ws.on('close', () => { this.clients.delete(ws); logger.info('WS 客户端已断开', { total: this.clients.size }); });
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  broadcast(type: string, data: any) {
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  sendTo(client: WebSocket, type: string, data: any) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, data, ts: Date.now() }));
    }
  }
}

export const wsBus = new WsBus();
