import { sessionStore, UserSession } from './session-store.js';
import { messageStore } from './message-store.js';

export type { UserSession } from './session-store.js';

export function getSession(userId: string, agentId = 'default'): UserSession {
  return sessionStore.get(userId, agentId);
}

export function ensureSession(userId: string, agentId = 'default'): UserSession {
  return sessionStore.ensure(userId, agentId);
}

export function updateSession(userId: string, data: Partial<UserSession>) {
  sessionStore.update(userId, data);
}

export function addMessageToContext(userId: string, role: string, text: string) {
  const session = getSession(userId);
  session.context.push({ role, text, ts: Date.now() });
  if (session.context.length > 40) session.context = session.context.slice(-40);
  updateSession(userId, { context: session.context });
  messageStore.insert({ platform: 'memory', channel: 'private', userId, text, role, timestamp: Date.now() });
}

export function getContextMessages(userId: string, maxTurns = 20) {
  const session = getSession(userId);
  return session.context.slice(-maxTurns * 2);
}

export { sessionStore, messageStore };
