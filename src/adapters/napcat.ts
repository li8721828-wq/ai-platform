import { WebSocket } from 'ws';
import { agentManager } from '../engine/agent-manager.js';
import { channelManager } from '../channel-manager.js';
import { logger } from '../logger.js';
import type { ChannelConfig, IChannelAdapter } from '../channel-manager.js';

export class NapCatChannel implements IChannelAdapter {
  readonly id: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private url = 'ws://127.0.0.1:8080';
  private token = '';
  status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  onStatusChange?: (status: string) => void;

  constructor(id: string) {
    this.id = id;
  }

  applyConfig(config: ChannelConfig) {
    this.url = config.ws_url;
    this.token = config.token;
  }

  async start(): Promise<void> {
    if (this.ws) return;
    this.status = 'connecting';
    this.emitStatus();

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.on('open', () => {
          this.status = 'connected';
          this.emitStatus();
          logger.info('NapCat 已连接', { id: this.id });
          resolve();
        });
        this.ws.on('message', (data: Buffer) => this.onMessage(data));
        this.ws.on('close', () => {
          this.status = 'disconnected';
          this.emitStatus();
          logger.warn('NapCat 连接断开', { id: this.id });
          this.ws = null;
          this.scheduleReconnect();
        });
        this.ws.on('error', (err: Error) => {
          this.status = 'error';
          this.emitStatus();
          logger.error('NapCat 连接错误', { id: this.id, error: err.message });
          this.ws = null;
          resolve();
        });
      } catch (err: any) {
        this.status = 'error';
        this.emitStatus();
        logger.error('NapCat 创建连接失败', { id: this.id, error: err.message });
        resolve();
      }
    });
  }

  stop() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.status = 'disconnected';
    this.emitStatus();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(err => logger.error('NapCat 重连失败', { error: (err as Error).message }));
    }, 10000);
  }

  private emitStatus() {
    this.onStatusChange?.(this.status);
  }

  private onMessage(data: Buffer) {
    try {
      const payload = JSON.parse(data.toString());
      if (payload.post_type === 'message') {
        const msg = this.normalize(payload);
        if (msg) {
          agentManager.handleMessage(msg).then(reply => {
            if (reply) this.sendReply(payload, reply);
          }).catch(err => logger.error('NapCat handleMessage 失败', { error: (err as Error).message }));
        }
      }
    } catch (err) {
      logger.error('NapCat 消息解析失败', { error: (err as Error).message });
    }
  }

  private normalize(payload: any) {
    if (payload.message_type !== 'private' && payload.message_type !== 'group') return null;
    const textSeg = payload.message?.find((s: any) => s.type === 'text');
    if (!textSeg) return null;
    return {
      id: `msg_${payload.message_id}`,
      platform: 'qq' as const,
      channel: payload.message_type === 'group' ? 'group' as const : 'private' as const,
      from: {
        userId: String(payload.user_id),
        userName: payload.sender?.nickname,
        groupId: payload.group_id ? String(payload.group_id) : undefined,
        groupName: payload.sender?.group_name,
      },
      text: textSeg.data.text.trim(),
      segments: payload.message || [],
      timestamp: payload.time * 1000,
      raw: payload,
    };
  }

  sendMsg(target: { userId?: string; groupId?: string }, text: string) {
    if (!this.ws) return;
    const payload: any = { action: 'send_msg', params: { message: text } };
    if (target.userId) payload.params.user_id = parseInt(target.userId);
    if (target.groupId) payload.params.group_id = parseInt(target.groupId);
    this.ws.send(JSON.stringify(payload));
  }

  private sendReply(original: any, text: string) {
    if (original.message_type === 'private') {
      this.sendMsg({ userId: String(original.user_id) }, text);
    } else if (original.message_type === 'group') {
      this.sendMsg({ groupId: String(original.group_id) }, text);
    }
  }
}

// Auto-register adapter
channelManager.registerAdapter('qq', (id) => new NapCatChannel(id));
