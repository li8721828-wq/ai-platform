import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { Config } from '../config.js';

let db: SqlJsDatabase;
let dbPath: string;

export async function initDb(cfg: Config): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  dbPath = path.join(cfg.data_dir, 'app.db');
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  applySchema();
  saveDb();
  return db;
}

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export function saveDb() {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dbPath, buffer);
  }
}

function applySchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      duration INTEGER,
      status TEXT NOT NULL DEFAULT 'ok',
      metadata TEXT DEFAULT '{}',
      error TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces(trace_id);
    CREATE INDEX IF NOT EXISTS idx_traces_name ON traces(name);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      trace_id TEXT,
      platform TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'private',
      user_id TEXT NOT NULL,
      user_name TEXT,
      group_id TEXT,
      text TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      reply_to TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'default',
      current_agent TEXT NOT NULL DEFAULT 'default',
      context TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id)
    );

    INSERT OR IGNORE INTO sessions(user_id, agent_id, current_agent, context, created_at, updated_at)
    VALUES ('__init__', 'default', 'default', '[]', 0, 0);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      model TEXT NOT NULL,
      temperature REAL DEFAULT 0.7,
      max_tokens INTEGER,
      system_prompt TEXT NOT NULL,
      persona TEXT,
      memory_config TEXT,
      greeting TEXT,
      tools TEXT DEFAULT '[]',
      mcp_servers TEXT DEFAULT '[]',
      route TEXT NOT NULL DEFAULT '{"type":"catchall"}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS long_term_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      type TEXT NOT NULL DEFAULT 'interaction',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'disconnected',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO channels(id, type, name, enabled, config, status, created_at, updated_at)
    VALUES ('napcat', 'qq', 'QQ (NapCat)', 0, '{"ws_url":"ws://127.0.0.1:8080","token":""}', 'disconnected', 0, 0);
  `);
}

// Helper: query all rows as objects
export function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: query one row as object
export function queryOne(sql: string, params: any[] = []): any | undefined {
  const rows = queryAll(sql, params);
  return rows[0];
}

// Helper: run a statement
export function runStmt(sql: string, params: any[] = []): void {
  if (params.length) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    stmt.step();
    stmt.free();
  } else {
    db.run(sql);
  }
  saveDb();
}
