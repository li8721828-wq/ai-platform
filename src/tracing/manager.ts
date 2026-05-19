import { runStmt, queryAll, queryOne } from '../db/sqlite.js';
import type { TraceSpan } from '../types.js';

class TraceManager {
  private currentTraces = new Map<string, TraceSpan[]>();

  start(name: string, parentId?: string): TraceSpan {
    const span: TraceSpan = {
      traceId: parentId ? this.getCurrentTraceId(parentId) : `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      parentId,
      spanId: `span_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      startTime: Date.now(),
      status: 'ok',
      metadata: {},
    };
    if (!this.currentTraces.has(span.traceId)) {
      this.currentTraces.set(span.traceId, []);
    }
    this.currentTraces.get(span.traceId)!.push(span);
    return span;
  }

  end(span: TraceSpan, error?: string) {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    if (error) { span.status = 'error'; span.error = error; }
    this.save(span);
  }

  private save(span: TraceSpan) {
    try {
      runStmt(`
        INSERT INTO traces (id, trace_id, parent_id, name, start_time, end_time, duration, status, metadata, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        span.spanId, span.traceId, span.parentId || null, span.name,
        span.startTime, span.endTime || null, span.duration || null,
        span.status, JSON.stringify(span.metadata), span.error || null, Date.now(),
      ]);
    } catch (err) {
      console.error('[Trace] 保存失败:', err);
    }
  }

  async trace<T>(name: string, fn: (span: TraceSpan) => Promise<T>): Promise<T> {
    const span = this.start(name);
    try {
      const result = await fn(span);
      this.end(span);
      return result;
    } catch (err: any) {
      this.end(span, err.message);
      throw err;
    }
  }

  private getCurrentTraceId(spanId: string): string {
    for (const [traceId, spans] of this.currentTraces) {
      if (spans.some(s => s.spanId === spanId)) return traceId;
    }
    return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getTraces(limit = 50, offset = 0): TraceSpan[] {
    return queryAll('SELECT * FROM traces ORDER BY start_time DESC LIMIT ? OFFSET ?', [limit, offset]).map(mapSpan);
  }

  getTrace(traceId: string): TraceSpan[] {
    return queryAll('SELECT * FROM traces WHERE trace_id = ? ORDER BY start_time', [traceId]).map(mapSpan);
  }
}

function mapSpan(row: any): TraceSpan {
  return {
    traceId: row.trace_id,
    parentId: row.parent_id || undefined,
    spanId: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time || undefined,
    duration: row.duration || undefined,
    status: row.status,
    metadata: safeParse(row.metadata, {}),
    error: row.error || undefined,
  };
}

function safeParse(val: any, fallback: any) {
  try { return JSON.parse(val); } catch { return fallback; }
}

export const traceManager = new TraceManager();
