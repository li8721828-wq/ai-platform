import { runStmt, queryOne } from './db/sqlite.js';
import { safeJsonParse } from './utils.js';

export interface LlmSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

const DEFAULT_LLM: LlmSettings = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.7,
};

export function initSettingsTable() {
  runStmt(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
}

export function getLlmSettings(): LlmSettings {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', ['llm']);
  if (row) {
    const saved = safeJsonParse(row.value, null) as Partial<LlmSettings>;
    if (saved && saved.apiKey) return { ...DEFAULT_LLM, ...saved };
  }
  // 从环境变量回退
  if (process.env.LLM_API_KEY) {
    return {
      provider: 'deepseek',
      apiKey: process.env.LLM_API_KEY || '',
      baseUrl: process.env.LLM_BASE_URL || DEFAULT_LLM.baseUrl,
      model: process.env.LLM_MODEL || DEFAULT_LLM.model,
      temperature: parseFloat(process.env.LLM_TEMPERATURE || '') || DEFAULT_LLM.temperature,
    };
  }
  return { ...DEFAULT_LLM, apiKey: '' };
}

export function saveLlmSettings(s: LlmSettings) {
  runStmt('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    ['llm', JSON.stringify(s), Date.now()]);
}

export function getSetting(key: string): string | undefined {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value;
}

export function setSetting(key: string, value: string) {
  runStmt('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, value, Date.now()]);
}
