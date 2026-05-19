import type { AgentDef } from '../types.js';
import { queryAll, queryOne, runStmt } from '../db/sqlite.js';
import { eventBus } from '../event-bus.js';

export class AgentStore {
  list(): AgentDef[] {
    return queryAll('SELECT * FROM agents WHERE enabled = 1 ORDER BY id').map(mapRow);
  }

  listAll(): AgentDef[] {
    return queryAll('SELECT * FROM agents ORDER BY id').map(mapRow);
  }

  get(id: string): AgentDef | undefined {
    const row = queryOne('SELECT * FROM agents WHERE id = ?', [id]);
    return row ? mapRow(row) : undefined;
  }

  create(def: AgentDef): void {
    const now = Date.now();
    const params: any[] = [
      def.id ?? '',
      def.name || def.id || '',
      def.enabled !== false ? 1 : 0,
      def.model || '',
      def.temperature ?? null,
      def.maxTokens ?? null,
      def.systemPrompt || '',
      JSON.stringify(def.persona ?? null),
      JSON.stringify(def.memory ?? null),
      def.greeting ?? null,
      JSON.stringify(def.tools ?? []),
      JSON.stringify(def.mcpServers ?? []),
      JSON.stringify(def.route ?? { type: 'catchall' }),
      now, now,
    ];
    const undefinedIdx = params.findIndex(p => p === undefined);
    if (undefinedIdx !== -1) {
      throw new Error(`参数[${undefinedIdx}] 值为 undefined: key=${['id','name','enabled','model','temperature','max_tokens','system_prompt','persona','memory_config','greeting','tools','mcp_servers','route','created_at','updated_at'][undefinedIdx]}`);
    }
    runStmt(`
      INSERT INTO agents (id, name, enabled, model, temperature, max_tokens, system_prompt,
        persona, memory_config, greeting, tools, mcp_servers, route, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, params);
    eventBus.emit('agents:changed');
  }

  update(id: string, def: Partial<AgentDef>): void {
    const existing = this.get(id);
    if (!existing) throw new Error(`Agent ${id} not found`);
    const merged = { ...existing, ...def };
    const now = Date.now();
    runStmt(`
      UPDATE agents SET name=?, enabled=?, model=?, temperature=?, max_tokens=?,
        system_prompt=?, persona=?, memory_config=?, greeting=?,
        tools=?, mcp_servers=?, route=?, updated_at=?
      WHERE id=?
    `, [
      merged.name, merged.enabled !== false ? 1 : 0,
      merged.model, merged.temperature ?? null, merged.maxTokens ?? null,
      merged.systemPrompt, JSON.stringify(merged.persona ?? null),
      JSON.stringify(merged.memory ?? null), merged.greeting ?? null,
      JSON.stringify(merged.tools ?? []), JSON.stringify(merged.mcpServers ?? []),
      JSON.stringify(merged.route), now, id,
    ]);
    eventBus.emit('agents:changed');
  }

  remove(id: string): void {
    runStmt('DELETE FROM agents WHERE id = ?', [id]);
    eventBus.emit('agents:changed');
  }

  toggle(id: string): void {
    runStmt('UPDATE agents SET enabled = CASE WHEN enabled THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?', [Date.now(), id]);
    eventBus.emit('agents:changed');
  }
}

function mapRow(row: any): AgentDef {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    model: row.model,
    temperature: row.temperature ?? undefined,
    maxTokens: row.max_tokens ?? undefined,
    systemPrompt: row.system_prompt,
    persona: safeJsonParse(row.persona),
    memory: safeJsonParse(row.memory_config),
    greeting: row.greeting,
    tools: safeJsonParse(row.tools, []),
    mcpServers: safeJsonParse(row.mcp_servers, []),
    route: safeJsonParse(row.route, { type: 'catchall' }),
  };
}

function safeJsonParse(val: any, fallback: any = null) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

export const agentStore = new AgentStore();
