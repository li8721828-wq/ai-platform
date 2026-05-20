import { runStmt, queryAll } from './db/sqlite.js';
import { safeJsonParse } from './utils.js';
import { logger } from './logger.js';

export interface ChannelConfig {
  [key: string]: any;
}

export interface ChannelStatus {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  config: ChannelConfig;
  status: string;
  adapter?: string;
}

export interface IChannelAdapter {
  readonly id: string;
  readonly status: string;
  onStatusChange?: (status: string) => void;
  applyConfig(config: ChannelConfig): void;
  start(): Promise<void>;
  stop(): void;
}

type AdapterFactory = (id: string) => IChannelAdapter;

class ChannelManager {
  private channels = new Map<string, ChannelStatus>();
  private adapters = new Map<string, AdapterFactory>();
  private instances = new Map<string, IChannelAdapter>();

  registerAdapter(type: string, factory: AdapterFactory) {
    this.adapters.set(type, factory);
    logger.info('通道适配器已注册', { type });
  }

  init() {
    const rows = queryAll('SELECT * FROM channels');
    for (const row of rows as any[]) {
      const ch: ChannelStatus = {
        id: row.id,
        type: row.type,
        name: row.name,
        enabled: row.enabled === 1,
        config: safeJsonParse(row.config, {}),
        status: row.status,
      };
      this.channels.set(ch.id, ch);
      this.tryCreateInstance(ch);
    }
  }

  private tryCreateInstance(ch: ChannelStatus) {
    const factory = this.adapters.get(ch.type);
    if (!factory) return;
    try {
      const instance = factory(ch.id);
      instance.onStatusChange = (s: string) => {
        ch.status = s;
        runStmt('UPDATE channels SET status = ?, updated_at = ? WHERE id = ?', [s, Date.now(), ch.id]);
      };
      instance.applyConfig(ch.config);
      this.instances.set(ch.id, instance);
      ch.adapter = ch.type;
      if (ch.enabled) {
        instance.start().catch(err => logger.error(`通道启动失败: ${ch.id}`, { error: (err as Error).message }));
      }
    } catch (err) {
      logger.error(`创建通道实例失败: ${ch.id}`, { error: (err as Error).message });
    }
  }

  list(): ChannelStatus[] {
    return Array.from(this.channels.values()).map(c => ({
      id: c.id, type: c.type, name: c.name,
      enabled: c.enabled, config: c.config, status: c.status, adapter: c.adapter,
    }));
  }

  get(id: string): ChannelStatus | undefined {
    return this.channels.get(id);
  }

  getInstance(id: string): IChannelAdapter | undefined {
    return this.instances.get(id);
  }

  updateConfig(id: string, config: any) {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`通道 ${id} 不存在`);
    ch.config = config;
    this.instances.get(id)?.applyConfig(config);
    runStmt('UPDATE channels SET config = ?, updated_at = ? WHERE id = ?', [JSON.stringify(config), Date.now(), id]);
  }

  async start(id: string) {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`通道 ${id} 不存在`);
    const inst = this.instances.get(id);
    if (!inst) throw new Error(`通道 ${id} 无适配器实例`);
    inst.applyConfig(ch.config);
    await inst.start();
    ch.status = inst.status;
    ch.enabled = true;
    runStmt('UPDATE channels SET enabled = 1, status = ?, updated_at = ? WHERE id = ?', [ch.status, Date.now(), id]);
  }

  stop(id: string) {
    const ch = this.channels.get(id);
    if (!ch) return;
    this.instances.get(id)?.stop();
    ch.status = 'disconnected';
    ch.enabled = false;
    runStmt('UPDATE channels SET enabled = 0, status = ?, updated_at = ? WHERE id = ?', ['disconnected', Date.now(), id]);
  }

  stopAll() {
    for (const id of this.instances.keys()) {
      try { this.stop(id); } catch { /* ignore */ }
    }
  }
}

export const channelManager = new ChannelManager();
