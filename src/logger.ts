import fs from 'fs';
import path from 'path';
import { getTraceContext } from './trace-context.js';

// ===== Types =====
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'audit';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5, audit: 6,
};

export interface LogError {
  name: string;
  message: string;
  stack?: string;
}

export interface LogAudit {
  action: string;
  resource: string;
  resourceId?: string;
  before?: any;
  after?: any;
  performedBy?: string;
}

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  duration_ms?: number;
  error?: LogError;
  audit?: LogAudit;
  meta?: Record<string, unknown>;
}

export interface Transport {
  write(entry: LogEntry): void;
}

// ===== Redaction =====
const SENSITIVE_KEYS = new Set([
  'api_key', 'apiKey', 'apikey',
  'password', 'passwd', 'secret', 'token', 'auth_token',
  'authorization', 'x-auth-token',
  'private_key', 'privateKey',
]);

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key)) {
    if (typeof value === 'string' && value.length > 4) {
      return `${value.slice(0, 4)}****[REDACTED]`;
    }
    return '[REDACTED]';
  }
  return value;
}

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj;
  if (Array.isArray(obj)) return obj.map(v => redact(v, depth + 1));
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = redactValue(k, v);
      if (result[k] === v && typeof v === 'object') {
        result[k] = redact(v, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

// ===== Retention Policy =====
export interface RetentionPolicy {
  maxSizeMB: number;
  maxFiles: number;
  maxAgeDays: number;
}

const DEFAULT_RETENTION: RetentionPolicy = {
  maxSizeMB: 10,
  maxFiles: 10,
  maxAgeDays: 30,
};

// ===== Colors =====
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const GRAY = '\x1b[90m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

const LEVEL_STYLE: Record<LogLevel, { color: string; emoji: string; label: string }> = {
  trace: { color: GRAY, emoji: '·', label: 'TRACE' },
  debug: { color: CYAN, emoji: '🔍', label: 'DEBUG' },
  info: { color: GREEN, emoji: 'ℹ', label: 'INFO' },
  warn: { color: YELLOW, emoji: '⚠', label: 'WARN' },
  error: { color: RED, emoji: '✘', label: 'ERROR' },
  fatal: { color: WHITE, emoji: '🔥', label: 'FATAL' },
  audit: { color: MAGENTA, emoji: '📋', label: 'AUDIT' },
};

// ===== Console Transport =====
class ConsoleTransport implements Transport {
  write(entry: LogEntry) {
    const style = LEVEL_STYLE[entry.level];
    const { color, emoji } = style;

    // Parse "[Component] message"
    let component = '';
    let message = entry.msg;
    const m = entry.msg.match(/^\[([^\]]+)\]\s*(.*)/);
    if (m) {
      component = m[1].trim();
      message = m[2].trim();
    }

    const levelTag = `${color}${emoji} ${style.label}${RESET}`;

    const comp = component
      ? `${CYAN}${component}${RESET}`
      : '';

    // Trace info
    const trace = entry.traceId
      ? ` ${GRAY}[${entry.traceId.slice(0, 8)}]${RESET}`
      : '';

    // Duration
    const dur = typeof entry.duration_ms === 'number'
      ? ` ${GRAY}${entry.duration_ms}ms${RESET}`
      : '';

    // Error summary
    const errStr = entry.error
      ? ` ${RED}${entry.error.name}: ${entry.error.message}${RESET}`
      : '';

    // Build key-value summary from meta (exclude internal fields)
    const metaStr = buildMetaString(entry);

    const parts = [
      levelTag,
      comp,
      message,
      metaStr,
      dur,
      errStr,
      trace,
    ].filter(Boolean);

    const line = `  ${parts.join(' ')}`;

    const method = entry.level === 'error' || entry.level === 'fatal' ? 'error'
      : entry.level === 'warn' ? 'warn'
      : 'log';
    console[method](line);
  }
}

function buildMetaString(entry: LogEntry): string {
  const pairs: string[] = [];

  if (entry.userId) pairs.push(`User: ${entry.userId.slice(0, 8)}`);
  if (entry.agentId) pairs.push(`Agent: ${entry.agentId}`);

  if (entry.meta) {
    for (const [k, v] of Object.entries(entry.meta)) {
      if (['elapsed', 'traceId'].includes(k)) continue;
      const val = typeof v === 'string' ? v
        : typeof v === 'number' || typeof v === 'boolean' ? String(v)
        : JSON.stringify(v).slice(0, 60);
      pairs.push(`${k}: ${val}`);
    }
  }

  if (!pairs.length) return '';
  return ` ${YELLOW}(${pairs.join(', ')})${RESET}`;
}

// ===== File Transport with Retention =====
class FileTransport implements Transport {
  private filePath: string;
  private retention: RetentionPolicy;
  private stream: fs.WriteStream | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(filePath: string, retention: RetentionPolicy = DEFAULT_RETENTION) {
    this.filePath = filePath;
    this.retention = retention;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.scheduleCleanup();
  }

  write(entry: LogEntry) {
    const safe = redact(entry) as LogEntry;
    const line = JSON.stringify(safe) + '\n';
    this.checkRotation();
    if (!this.stream) {
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    }
    this.stream.write(line);
  }

  private checkRotation() {
    if (!this.stream) return;
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size >= this.retention.maxSizeMB * 1024 * 1024) {
        this.stream.end();
        this.stream = null;
        const rotated = this.filePath.replace(/(\.\w+)$/, `.${Date.now()}$1`);
        fs.renameSync(this.filePath, rotated);
        this.cleanupOldFiles();
      }
    } catch { }
  }

  private cleanupOldFiles() {
    try {
      const dir = path.dirname(this.filePath);
      const base = path.basename(this.filePath);
      const ext = path.extname(base);
      const name = base.slice(0, -ext.length);

      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(name + '.') && f.endsWith(ext))
        .map(f => ({
          name: f,
          path: path.join(dir, f),
          time: fs.statSync(path.join(dir, f)).mtimeMs,
        }))
        .sort((a, b) => b.time - a.time);

      // Remove by maxFiles
      if (files.length > this.retention.maxFiles) {
        for (const f of files.slice(this.retention.maxFiles)) {
          fs.unlinkSync(f.path);
        }
      }

      // Remove by maxAge
      const cutoff = Date.now() - this.retention.maxAgeDays * 86400000;
      for (const f of files) {
        if (f.time < cutoff) {
          try { fs.unlinkSync(f.path); } catch { }
        }
      }
    } catch { }
  }

  private scheduleCleanup() {
    this.cleanupTimer = setInterval(() => this.cleanupOldFiles(), 3600000);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as any).unref();
    }
  }

  close() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.stream?.end();
    this.stream = null;
  }
}

// ===== Logger =====
export class Logger {
  private minLevel: LogLevel;
  private transports: Transport[] = [];
  private component: string;

  constructor(level: LogLevel = 'info', filePath?: string, component = '') {
    this.minLevel = level;
    this.component = component;
    this.addTransport(new ConsoleTransport());
    if (filePath) {
      this.addTransport(new FileTransport(filePath));
    }
    if (process.env.LOG_LEVEL && LEVEL_ORDER[process.env.LOG_LEVEL as LogLevel] !== undefined) {
      this.minLevel = process.env.LOG_LEVEL as LogLevel;
    }
  }

  addTransport(t: Transport) {
    this.transports.push(t);
  }

  private log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const ctx = getTraceContext();
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg: this.component ? `[${this.component}] ${msg}` : msg,
      traceId: ctx?.traceId,
      spanId: ctx?.spanId,
      parentSpanId: ctx?.parentSpanId,
      userId: ctx?.userId,
      agentId: ctx?.agentId,
      sessionId: ctx?.sessionId,
    };

    if (meta) {
      if (typeof meta.duration_ms === 'number') {
        entry.duration_ms = meta.duration_ms;
        delete meta.duration_ms;
      }
      if (meta.error instanceof Error) {
        entry.error = { name: meta.error.name, message: meta.error.message, stack: meta.error.stack };
        delete meta.error;
      } else if (meta.error && typeof meta.error === 'object') {
        entry.error = meta.error as LogError;
        delete meta.error;
      }
      if (meta.audit) {
        entry.audit = meta.audit as LogAudit;
        entry.level = 'audit';
        delete meta.audit;
      }
      if (Object.keys(meta).length > 0) {
        entry.meta = meta as Record<string, unknown>;
      }
    }

    for (const t of this.transports) {
      try { t.write(entry); } catch { }
    }
  }

  trace(msg: string, meta?: Record<string, unknown>) { this.log('trace', msg, meta); }
  debug(msg: string, meta?: Record<string, unknown>) { this.log('debug', msg, meta); }
  info(msg: string, meta?: Record<string, unknown>) { this.log('info', msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>) { this.log('warn', msg, meta); }
  error(msg: string, meta?: Record<string, unknown>) { this.log('error', msg, meta); }
  fatal(msg: string, meta?: Record<string, unknown>) { this.log('fatal', msg, meta); }
  audit(msg: string, meta?: Record<string, unknown>) { this.log('audit', msg, meta); }

  child(component: string): Logger {
    const child = new Logger(this.minLevel, undefined, component);
    child.transports = this.transports;
    return child;
  }

  close() {
    for (const t of this.transports) {
      if (t instanceof FileTransport) t.close();
    }
  }
}

export const logger = new Logger('info', 'data/logs/app.log');
