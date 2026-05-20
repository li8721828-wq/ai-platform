import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  source?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

export function getTraceId(): string {
  return storage.getStore()?.traceId || '-';
}

export function getUserId(): string | undefined {
  return storage.getStore()?.userId;
}

export function getAgentId(): string | undefined {
  return storage.getStore()?.agentId;
}

function shortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export function runWithTrace<T>(
  ctx: Partial<TraceContext>,
  fn: () => T,
): T {
  const parent = storage.getStore();
  const merged: TraceContext = {
    traceId: ctx.traceId || parent?.traceId || shortId(),
    spanId: shortId(),
    parentSpanId: parent?.spanId,
    userId: ctx.userId ?? parent?.userId,
    agentId: ctx.agentId ?? parent?.agentId,
    sessionId: ctx.sessionId ?? parent?.sessionId,
    source: ctx.source ?? parent?.source,
  };
  return storage.run(merged, fn);
}

export function updateTraceContext(partial: Partial<TraceContext>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  Object.assign(ctx, partial);
  if (partial.traceId) ctx.traceId = partial.traceId;
}

export function createTraceMiddleware(): (req: any, res: any, next: () => void) => void {
  return (req, res, next) => {
    const incoming = req.headers['x-trace-id'] as string | undefined;
    runWithTrace(
      {
        traceId: incoming,
        source: 'http',
      },
      () => {
        const ctx = getTraceContext()!;
        res.setHeader('x-trace-id', ctx.traceId);
        next();
      },
    );
  };
}
