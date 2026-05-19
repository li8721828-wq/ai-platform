import { queryOne, queryAll, runStmt } from '../db/sqlite.js';

export interface UserSession {
  userId: string;
  agentId: string;
  currentAgent: string;
  context: any[];
  createdAt: number;
  updatedAt: number;
}

export function getSession(userId: string, agentId = 'default'): UserSession {
  const row = queryOne('SELECT * FROM sessions WHERE user_id = ?', [userId]);
  if (row) return mapRow(row);
  return createSession(userId, agentId);
}

export function ensureSession(userId: string, agentId = 'default'): UserSession {
  const row = queryOne('SELECT * FROM sessions WHERE user_id = ?', [userId]);
  if (row) return mapRow(row);
  return createSession(userId, agentId);
}

export function updateSession(userId: string, data: Partial<UserSession>) {
  runStmt(`
    UPDATE sessions
    SET current_agent = COALESCE(?, current_agent),
        context = COALESCE(?, context),
        updated_at = ?
    WHERE user_id = ?
  `, [data.currentAgent || null, data.context ? JSON.stringify(data.context) : null, Date.now(), userId]);
}

function createSession(userId: string, agentId: string): UserSession {
  const now = Date.now();
  runStmt(`
    INSERT OR IGNORE INTO sessions (user_id, agent_id, current_agent, context, created_at, updated_at)
    VALUES (?, ?, ?, '[]', ?, ?)
  `, [userId, agentId, agentId, now, now]);
  return { userId, agentId, currentAgent: agentId, context: [], createdAt: now, updatedAt: now };
}

function mapRow(row: any): UserSession {
  return {
    userId: row.user_id,
    agentId: row.agent_id,
    currentAgent: row.current_agent,
    context: JSON.parse(row.context || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addMessageToContext(userId: string, role: string, text: string) {
  const session = getSession(userId);
  session.context.push({ role, text, ts: Date.now() });
  if (session.context.length > 40) session.context = session.context.slice(-40);
  updateSession(userId, { context: session.context });
}

export function getContextMessages(userId: string, maxTurns = 20) {
  const session = getSession(userId);
  return session.context.slice(-maxTurns * 2);
}
