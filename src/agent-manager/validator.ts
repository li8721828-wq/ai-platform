import type { AgentDef } from '../types.js';

export function validateAgent(def: Partial<AgentDef>): string | null {
  if (!def.id || typeof def.id !== 'string') return 'id 是必填项';
  if (def.id.length < 2 || def.id.length > 64) return 'id 长度需在 2-64 之间';
  if (!/^[a-zA-Z0-9_-]+$/.test(def.id)) return 'id 只能包含字母、数字、下划线和连字符';
  if (!def.model) return 'model 是必填项';
  if (!def.systemPrompt) return 'system_prompt 是必填项';
  if (def.temperature !== undefined && (def.temperature < 0 || def.temperature > 2)) return 'temperature 需在 0-2 之间';
  if (def.maxTokens !== undefined && def.maxTokens < 1) return 'max_tokens 需大于 0';
  if (def.route && !['catchall', 'command', 'keyword', 'llm_match'].includes(def.route.type)) return 'route.type 不合法';
  return null;
}
