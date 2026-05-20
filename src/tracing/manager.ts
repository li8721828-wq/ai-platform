import { runStmt, queryAll, queryOne } from '../db/sqlite.js';
import { flushDb } from '../db/sqlite.js';
import type { TraceSpan } from '../types.js';
import { logger } from '../logger.js';

interface TraceConfig {
  sampleRate: number;
  slowThreshold: number;
}

export class TraceManager {
  private currentTraces = new Map<string, TraceSpan[]>();
  private pendingBatch: TraceSpan[] = [];
  private batchTimer: any = null;
  private config: TraceConfig = { sampleRate: 1.0, slowThreshold: 2000 };

  configure(cfg: Partial<TraceConfig>) {
    Object.assign(this.config, cfg);
  }

  start(name: string, parentId?: string): TraceSpan | null {
    // Sampling
    if (Math.random() > this.config.sampleRate && !parentId) return null;
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

  end(span: TraceSpan | null, error?: string) {
    if (!span) return;
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    if (error) { span.status = 'error'; span.error = error; }

    // Log slow spans
    if (span.duration >= this.config.slowThreshold) {
      logger.warn('慢 span 检测', { name: span.name, duration: span.duration, traceId: span.traceId });
    }

    this.pendingBatch.push(span);
    this.scheduleFlush();

    // Clean up memory
    const traces = this.currentTraces.get(span.traceId);
    if (traces) {
      const idx = traces.indexOf(span);
      if (idx !== -1) traces.splice(idx, 1);
      if (traces.length === 0) this.currentTraces.delete(span.traceId);
    }
  }

  private scheduleFlush() {
    if (this.batchTimer) return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flush();
    }, 2000);
  }

  flush() {
    if (!this.pendingBatch.length) return;
    const batch = this.pendingBatch.splice(0, 100);
    for (const span of batch) {
      try {
        runStmt(`
          INSERT OR IGNORE INTO traces (id, trace_id, parent_id, name, start_time, end_time, duration, status, metadata, error, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          span.spanId, span.traceId, span.parentId || null, span.name,
          span.startTime, span.endTime || null, span.duration || null,
          span.status, JSON.stringify(span.metadata), span.error || null, Date.now(),
        ]);
      } catch (err) {
        logger.error('Trace 保存失败', { error: (err as Error).message });
      }
    }
    flushDb();
  }

  async trace<T>(name: string, fn: (span: TraceSpan) => Promise<T>): Promise<T> {
    const span = this.start(name);
    try {
      const result = await fn(span!);
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

  getStats() {
    const total = queryOne('SELECT count(*) as count FROM traces');
    const errors = queryOne("SELECT count(*) as count FROM traces WHERE status = 'error'");
    const avgDuration = queryOne('SELECT avg(duration) as avg FROM traces WHERE duration IS NOT NULL');
    return {
      total: total?.count || 0,
      errors: errors?.count || 0,
      avgDuration: Math.round(avgDuration?.avg || 0),
      samplingRate: this.config.sampleRate,
    };
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
