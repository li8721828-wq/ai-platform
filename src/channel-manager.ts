import { runStmt, queryAll } from './db/sqlite.js';
import { NapCatChannel } from './adapters/napcat.js';

interface ChannelRecord {
  id: string;
  type: string;
  name: string;
  enabled: number;
  config: string;
  status: string;
}

interface ManagedChannel {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  config: any;
  status: string;
  instance?: NapCatChannel;
}

class ChannelManager {
  private channels = new Map<string, ManagedChannel>();

  init() {
    const rows = queryAll('SELECT * FROM channels');
    for (const row of rows as any[]) {
      const ch: ManagedChannel = {
        id: row.id,
        type: row.type,
        name: row.name,
        enabled: row.enabled === 1,
        config: safeJson(row.config, {}),
        status: row.status,
      };
      if (ch.id === 'napcat') {
        ch.instance = new NapCatChannel();
        ch.instance.onStatusChange = (s: string) => {
          ch.status = s;
          runStmt('UPDATE channels SET status = ?, updated_at = ? WHERE id = ?', [s, Date.now(), ch.id]);
        };
        ch.instance.applyConfig(ch.config);
        if (ch.enabled) {
          ch.instance.start();
        }
      }
      this.channels.set(ch.id, ch);
    }
  }

  list(): ManagedChannel[] {
    return Array.from(this.channels.values()).map(c => ({
      id: c.id,
      type: c.type,
      name: c.name,
      enabled: c.enabled,
      config: c.config,
      status: c.status,
    }));
  }

  get(id: string): ManagedChannel | undefined {
    return this.channels.get(id);
  }

  updateConfig(id: string, config: any) {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`通道 ${id} 不存在`);
    ch.config = config;
    ch.instance?.applyConfig(config);
    runStmt('UPDATE channels SET config = ?, updated_at = ? WHERE id = ?', [JSON.stringify(config), Date.now(), id]);
  }

  async start(id: string) {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`通道 ${id} 不存在`);
    if (!ch.instance) throw new Error(`通道 ${id} 不支持`);

    ch.instance.applyConfig(ch.config);
    await ch.instance.start();
    ch.status = ch.instance.status;
    ch.enabled = true;
    runStmt('UPDATE channels SET enabled = 1, status = ?, updated_at = ? WHERE id = ?', [ch.status, Date.now(), id]);
  }

  stop(id: string) {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`通道 ${id} 不存在`);
    ch.instance?.stop();
    ch.status = 'disconnected';
    ch.enabled = false;
    runStmt('UPDATE channels SET enabled = 0, status = ?, updated_at = ? WHERE id = ?', ['disconnected', Date.now(), id]);
  }

  setEnabled(id: string, enabled: boolean) {
    const ch = this.channels.get(id);
    if (!ch) throw new Error(`通道 ${id} 不存在`);
    ch.enabled = enabled;
    runStmt('UPDATE channels SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, Date.now(), id]);
  }
}

function safeJson(val: string, fallback: any) {
  try { return JSON.parse(val); } catch { return fallback; }
}

export const channelManager = new ChannelManager();
