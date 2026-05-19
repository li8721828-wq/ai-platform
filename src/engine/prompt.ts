import type { AgentDef, Persona } from '../types.js';

export interface MessageParam {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function buildSystemMessages(agent: AgentDef): string[] {
  const parts: string[] = [];
  parts.push(agent.systemPrompt);
  if (agent.persona) {
    parts.push(renderPersona(agent.persona));
  }
  return parts;
}

function renderPersona(p: Persona): string {
  const lines: string[] = ['===== 角色设定 ====='];
  if (p.name) lines.push(`- 角色名：${p.name}`);
  if (p.personality?.length) lines.push(`- 性格：${p.personality.join('、')}`);
  if (p.speakingStyle) lines.push(`- 说话风格：${p.speakingStyle}`);
  if (p.background) lines.push(`- 背景设定：${p.background}`);
  if (p.likes?.length) lines.push(`- 喜好：${p.likes.join('、')}`);
  if (p.dislikes?.length) lines.push(`- 厌恶：${p.dislikes.join('、')}`);
  if (p.customFields) {
    for (const [k, v] of Object.entries(p.customFields)) {
      lines.push(`- ${k}：${v}`);
    }
  }
  lines.push('=====');
  return lines.join('\n');
}
