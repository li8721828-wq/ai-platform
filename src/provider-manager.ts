import type { ModelProvider } from './types.js';
import { queryAll, queryOne, runStmt } from './db/sqlite.js';
import { genId, safeJsonParse } from './utils.js';
import { clearModelCache } from './engine/model-factory.js';
import { logger } from './logger.js';

export class ProviderManager {
  getAll(): ModelProvider[] {
    return queryAll('SELECT * FROM model_providers ORDER BY is_default DESC, name ASC');
  }

  get(id: string): ModelProvider | undefined {
    return queryOne('SELECT * FROM model_providers WHERE id = ?', [id]);
  }

  getDefault(): ModelProvider | undefined {
    return queryOne('SELECT * FROM model_providers WHERE is_default = 1');
  }

  create(data: Partial<ModelProvider>): ModelProvider {
    const dup = queryOne(
      'SELECT id, name FROM model_providers WHERE api_key = ? AND models = ?',
      [data.apiKey || '', data.models || '[]'],
    );
    if (dup) throw new Error(`模型已存在: "${dup.name}" (${dup.id})，请勿重复添加`);
    const id = data.id || genId('prov_');
    const now = Date.now();
    runStmt(
      `INSERT INTO model_providers (id, name, provider, api_key, base_url, models, is_default, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.name || '', data.provider || 'openai', data.apiKey || '', data.baseUrl || '',
       data.models || '[]', data.isDefault ? 1 : 0, data.enabled ?? 1, now, now],
    );
    clearModelCache();
    logger.info(`[ProviderManager] Provider created`, { id, name: data.name, provider: data.provider });
    return this.get(id)!;
  }

  update(id: string, data: Partial<ModelProvider>) {
    const existing = this.get(id);
    if (!existing) throw new Error('Provider not found');
    runStmt(
      `UPDATE model_providers SET name=?, provider=?, api_key=?, base_url=?, models=?, is_default=?, enabled=?, updated_at=?
       WHERE id=?`,
      [data.name ?? existing.name, data.provider ?? existing.provider,
       data.apiKey ?? existing.apiKey, data.baseUrl ?? existing.baseUrl,
       data.models ?? existing.models, data.isDefault ?? existing.isDefault,
       data.enabled ?? existing.enabled, Date.now(), id],
    );
    if (data.isDefault) {
      runStmt('UPDATE model_providers SET is_default = 0 WHERE id != ? AND is_default = 1', [id]);
    }
    clearModelCache();
    logger.info(`[ProviderManager] Provider updated`, { id, name: data.name || existing.name });
  }

  remove(id: string) {
    const p = this.get(id);
    runStmt('DELETE FROM model_providers WHERE id = ?', [id]);
    clearModelCache();
    logger.info(`[ProviderManager] Provider deleted`, { id, name: p?.name });
  }

  toggle(id: string): ModelProvider {
    const p = this.get(id);
    if (!p) throw new Error('Provider not found');
    const newVal = p.enabled ? 0 : 1;
    runStmt('UPDATE model_providers SET enabled = ?, updated_at = ? WHERE id = ?', [newVal, Date.now(), id]);
    clearModelCache();
    logger.info(`[ProviderManager] Provider toggled`, { id, name: p.name, enabled: !!newVal });
    return this.get(id)!;
  }

  getEffectiveConfig(agentProvider?: string) {
    if (agentProvider) {
      const p = this.get(agentProvider);
      if (p && p.apiKey && p.enabled) return p;
    }
    const def = this.getDefault();
    if (def && def.enabled) return def;
    const active = queryOne('SELECT * FROM model_providers WHERE enabled = 1 ORDER BY is_default DESC, name ASC');
    if (active) return active;
    return queryOne('SELECT * FROM model_providers ORDER BY is_default DESC, name ASC') || null;
  }
}

export const providerManager = new ProviderManager();
