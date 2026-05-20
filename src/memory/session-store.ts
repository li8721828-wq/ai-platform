import { queryOne, queryAll, runStmt } from '../db/sqlite.js';

export interface UserSession {
  userId: string;
  agentId: string;
  currentAgent: string;
  context: any[];
  createdAt: number;
  updatedAt: number;
}

export class SessionStore {
  get(userId: string, agentId = 'default'): UserSession {
    const row = queryOne('SELECT * FROM sessions WHERE user_id = ?', [userId]);
    if (row) return this.mapRow(row);
    return this.create(userId, agentId);
  }

  ensure(userId: string, agentId = 'default'): UserSession {
    const row = queryOne('SELECT * FROM sessions WHERE user_id = ?', [userId]);
    if (row) return this.mapRow(row);
    return this.create(userId, agentId);
  }

  update(userId: string, data: Partial<UserSession>) {
    runStmt(`
      UPDATE sessions
      SET current_agent = COALESCE(?, current_agent),
          context = COALESCE(?, context),
          updated_at = ?
      WHERE user_id = ?
    `, [data.currentAgent || null, data.context ? JSON.stringify(data.context) : null, Date.now(), userId]);
  }

  list(): any[] {
    return queryAll('SELECT user_id, current_agent, updated_at FROM sessions');
  }

  private create(userId: string, agentId: string): UserSession {
    const now = Date.now();
    runStmt(`
      INSERT OR IGNORE INTO sessions (user_id, agent_id, current_agent, context, created_at, updated_at)
      VALUES (?, ?, ?, '[]', ?, ?)
    `, [userId, agentId, agentId, now, now]);
    return { userId, agentId, currentAgent: agentId, context: [], createdAt: now, updatedAt: now };
  }

  private mapRow(row: any): UserSession {
    return {
      userId: row.user_id,
      agentId: row.agent_id,
      currentAgent: row.current_agent,
      context: JSON.parse(row.context || '[]'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const sessionStore = new SessionStore();
