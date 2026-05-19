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
    chunk_size: number;
    chunk_overlap: number;
    top_k: number;
    min_score: number;
  };
  web: { port: number };
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
  return parsed;
}
