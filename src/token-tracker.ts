import { runStmt, queryAll } from './db/sqlite.js';

export interface TokenRecord {
  id?: number;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  agentId?: string;
  userId?: string;
  createdAt?: number;
}

export interface TokenStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  callCount: number;
  modelBreakdown: { model: string; totalTokens: number; callCount: number }[];
}

export class TokenTracker {
  record(rec: TokenRecord) {
    runStmt(`
      INSERT INTO token_usage (provider_id, model, prompt_tokens, completion_tokens, total_tokens, agent_id, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      rec.providerId, rec.model, rec.promptTokens, rec.completionTokens,
      rec.totalTokens, rec.agentId || null, rec.userId || null, Date.now(),
    ]);
  }

  getProviderStats(providerId: string): TokenStats {
    const rows = queryAll(
      'SELECT model, sum(prompt_tokens) as pt, sum(completion_tokens) as ct, sum(total_tokens) as tt, count(*) as cnt FROM token_usage WHERE provider_id = ? GROUP BY model ORDER BY tt DESC',
      [providerId],
    );
    const total: TokenStats = { totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0, callCount: 0, modelBreakdown: [] };
    for (const r of rows as any[]) {
      total.totalPromptTokens += r.pt;
      total.totalCompletionTokens += r.ct;
      total.totalTokens += r.tt;
      total.callCount += r.cnt;
      total.modelBreakdown.push({ model: r.model, totalTokens: r.tt, callCount: r.cnt });
    }
    return total;
  }

  getGlobalStats() {
    const rows = queryAll(
      'SELECT provider_id, model, sum(prompt_tokens) as pt, sum(completion_tokens) as ct, sum(total_tokens) as tt, count(*) as cnt FROM token_usage GROUP BY provider_id, model ORDER BY tt DESC',
    );
    return rows.map((r: any) => ({
      providerId: r.provider_id,
      model: r.model,
      promptTokens: r.pt,
      completionTokens: r.ct,
      totalTokens: r.tt,
      callCount: r.cnt,
    }));
  }

  getProviderAgentCount(providerId: string): number {
    const rows = queryAll('SELECT count(*) as cnt FROM agents WHERE provider = ?', [providerId]);
    return (rows[0] as any)?.cnt || 0;
  }
}

export const tokenTracker = new TokenTracker();
