import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { AgentDef } from './types.js';

export interface Config {
  napcat: { ws_url: string; token?: string };
  llm: {
    provider: string;
    api_key: string;
    base_url: string;
    model: string;
    temperature: number;
  };
  agents: Record<string, Omit<AgentDef, 'id'>>;
  knowledge: {
    embed_model: string;
    embed_base_url: string;
    chunk_size: number;
    chunk_overlap: number;
    top_k: number;
    min_score: number;
  };
  web: { port: number };
  admin?: { password?: string };
  providers?: { id: string; name: string; provider: string; api_key: string; base_url: string; models: string; is_default: boolean }[];
  data_dir: string;
}

export function loadConfig(): Config {
  const configPath = path.resolve('config.yaml');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(raw) as Config;
  parsed.data_dir = path.resolve(parsed.data_dir || './data');
  fs.mkdirSync(parsed.data_dir, { recursive: true });
  fs.mkdirSync(path.join(parsed.data_dir, 'kb'), { recursive: true });
  fs.mkdirSync(path.join(parsed.data_dir, 'files'), { recursive: true });
  // 环境变量覆盖敏感配置
  if (process.env.LLM_API_KEY) parsed.llm.api_key = process.env.LLM_API_KEY;
  if (process.env.LLM_BASE_URL) parsed.llm.base_url = process.env.LLM_BASE_URL;
  if (process.env.ADMIN_PASSWORD) { parsed.admin = parsed.admin || {}; parsed.admin!.password = process.env.ADMIN_PASSWORD!; }
  return parsed;
}
