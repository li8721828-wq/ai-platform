import { runStmt, queryAll } from '../db/sqlite.js';
import type { Config } from '../config.js';
import { logger } from '../logger.js';

interface LongTermMemory {
  id: number; userId: string; agentId: string; content: string; summary: string | null; type: string; createdAt: number;
}

class MemoryCompressor {
  private timer: any = null;
  private cfg!: Config;
  private compressing = false;
  private readonly MAX_MEMORIES_PER_USER = 100;
  private readonly RETENTION_DAYS = 30;

  start(cfg: Config) {
    this.cfg = cfg;
    this.timer = setInterval(() => this.compress(), 30 * 60 * 1000);
    setTimeout(() => this.compress(), 60000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async addMemory(userId: string, agentId: string, content: string) {
    runStmt(
      'INSERT OR IGNORE INTO long_term_memories (user_id, agent_id, content, summary, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, agentId, content, null, 'interaction', Date.now()],
    );
  }

  getMemories(userId: string, agentId: string, limit = 5): LongTermMemory[] {
    return queryAll(
      'SELECT * FROM long_term_memories WHERE user_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, agentId, limit],
    ).map(mapMemory);
  }

  private async compress() {
    if (this.compressing) return;
    this.compressing = true;
    try {
      // 清理过期记忆
      const cutoff = Date.now() - this.RETENTION_DAYS * 24 * 60 * 60 * 1000;
      runStmt('DELETE FROM long_term_memories WHERE created_at < ?', [cutoff]);

      const users = queryAll(`
        SELECT l.user_id, l.agent_id
        FROM long_term_memories l
        WHERE l.summary IS NULL
        GROUP BY l.user_id, l.agent_id
        HAVING COUNT(*) >= 3
      `) as any[];

      for (const row of users) {
        // 超量清理
        const total = (queryAll('SELECT COUNT(*) as cnt FROM long_term_memories WHERE user_id = ? AND agent_id = ?', [row.user_id, row.agent_id]) as any[])[0]?.cnt || 0;
        if (total > this.MAX_MEMORIES_PER_USER) {
          const toDelete = total - this.MAX_MEMORIES_PER_USER;
          runStmt('DELETE FROM long_term_memories WHERE id IN (SELECT id FROM long_term_memories WHERE user_id = ? AND agent_id = ? ORDER BY created_at ASC LIMIT ?)', [row.user_id, row.agent_id, toDelete]);
        }

        const memories = queryAll(
          'SELECT * FROM long_term_memories WHERE user_id = ? AND agent_id = ? AND summary IS NULL ORDER BY created_at ASC LIMIT 10',
          [row.user_id, row.agent_id],
        ) as any[];

        if (memories.length < 2) continue;

        const combined = memories.map((m: any) => m.content).join('\n');
        const summary = `📝 ${row.user_id} 与 ${row.agent_id} 的对话摘要：\n${combined.slice(0, 500)}`;

        for (const m of memories) {
          runStmt('UPDATE long_term_memories SET summary = ? WHERE id = ?', [summary.slice(0, 200), m.id]);
        }
        logger.info('长期记忆已压缩', { userId: row.user_id, agentId: row.agent_id, count: memories.length });
      }
    } catch (err) {
      logger.error('长期记忆压缩失败', { error: (err as any).message });
    } finally {
      this.compressing = false;
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
