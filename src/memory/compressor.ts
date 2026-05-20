import { runStmt, queryAll } from '../db/sqlite.js';
import type { Config } from '../config.js';

interface LongTermMemory {
  id: number;
  userId: string;
  agentId: string;
  content: string;
  summary: string | null;
  type: string;
  createdAt: number;
}

class MemoryCompressor {
  private timer: any = null;
  private cfg!: Config;

  start(cfg: Config) {
    this.cfg = cfg;
    this.timer = setInterval(() => this.compress(), 30 * 60 * 1000);
    setTimeout(() => this.compress(), 60000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async addMemory(userId: string, agentId: string, content: string) {
    const now = Date.now();
    runStmt(`
      INSERT OR IGNORE INTO long_term_memories (user_id, agent_id, content, summary, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, agentId, content, null, 'interaction', now]);
  }

  getMemories(userId: string, agentId: string, limit = 5): LongTermMemory[] {
    const rows = queryAll(`
      SELECT * FROM long_term_memories
      WHERE user_id = ? AND agent_id = ?
      ORDER BY created_at DESC LIMIT ?
    `, [userId, agentId, limit]);
    return rows.map(mapMemory);
  }

  private async compress() {
    try {
      const users = queryAll(`
        SELECT DISTINCT l.user_id, l.agent_id
        FROM long_term_memories l
        LEFT JOIN sessions s ON l.user_id = s.user_id
        WHERE l.summary IS NULL
        GROUP BY l.user_id, l.agent_id
        HAVING COUNT(*) >= 3
      `);

      for (const row of users as any[]) {
        const memories = queryAll(`
          SELECT * FROM long_term_memories
          WHERE user_id = ? AND agent_id = ? AND summary IS NULL
          ORDER BY created_at ASC LIMIT 10
        `, [row.user_id, row.agent_id]) as any[];

        if (memories.length < 2) continue;

        const combined = memories.map((m: any) => m.content).join('\n');
        const summary = `📝 用户${row.user_id} 与 ${row.agent_id} 的对话摘要：\n${combined.slice(0, 500)}`;

        for (const m of memories) {
          runStmt('UPDATE long_term_memories SET summary = ? WHERE id = ?', [summary.slice(0, 200), m.id]);
        }
      }
    } catch (err) {
      console.error('[MemoryCompressor] 压缩失败:', err);
    }
  }
}

function mapMemory(row: any): LongTermMemory {
  return {
    id: row.id, userId: row.user_id, agentId: row.agent_id,
    content: row.content, summary: row.summary,
    type: row.type, createdAt: row.created_at,
  };
}

export const memoryCompressor = new MemoryCompressor();
