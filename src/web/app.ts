import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { Config } from '../config.js';
import { logger } from '../logger.js';
import { agentStore } from '../agent-manager/store.js';
import { validateAgent } from '../agent-manager/validator.js';
import { traceManager } from '../tracing/manager.js';
import { agentManager } from '../engine/agent-manager.js';
import { channelManager } from '../channel-manager.js';
import { mcpRegistry } from '../mcp/registry.js';
import { mcpServerManager } from '../mcp/server.js';
import { queryAll, runStmt } from '../db/sqlite.js';
import { wsBus } from '../ws-bus.js';
import { getLlmSettings, saveLlmSettings } from '../settings.js';
import { clearModelCache } from '../engine/model-factory.js';
import { providerManager } from '../provider-manager.js';
import { tokenTracker } from '../token-tracker.js';
import { createTraceMiddleware, updateTraceContext } from '../trace-context.js';
import { auditLog } from '../audit-log.js';

export function createApp(cfg: Config) {
  const app = express();

  // Trace ID — 链路追踪，在所有中间件之前
  app.use(createTraceMiddleware());

  app.use((_req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); res.header('Access-Control-Allow-Headers', 'Content-Type, x-auth-token, x-trace-id'); res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE'); next(); });
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.resolve('src/web/static')));

  // request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const dur = Date.now() - start;
      const level: 'error' | 'warn' | 'info' = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](`[HTTP] ${req.method} ${req.path}`, { duration_ms: dur, status: res.statusCode });
    });
    next();
  });

  // ===== Auth =====
  const adminPassword = cfg.admin?.password;
  if (!adminPassword) {
    const randomPwd = crypto.randomBytes(4).toString('hex');
    logger.warn('[Auth] 未配置管理员密码，已随机生成', { password: randomPwd });
    logger.warn('[Auth] 请登录后立即修改密码');
    (cfg.admin as any) = { password: randomPwd };
  }
  const finalPwd = cfg.admin!.password!;
  const adminPasswordHash = crypto.createHash('sha256').update(finalPwd).digest('hex');
  let authToken: string | null = null;
  let tokenExpires = 0;
  const TOKEN_HEADER = 'x-auth-token';
  const TOKEN_TTL = 24 * 60 * 60 * 1000; // 24h

  function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  function authMiddleware(req: any, res: any, next: any) {
    if (req.path === '/api/auth/login') return next();
    if (req.path === '/api/health') return next();
    if (req.path.startsWith('/api/')) {
      const token = req.headers[TOKEN_HEADER];
      if (token === authToken && Date.now() < tokenExpires) return next();
      return res.status(401).json({ error: '未登录，请先登录' });
    }
    next();
  }
  app.use(authMiddleware);

  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    const inputHash = crypto.createHash('sha256').update(password || '').digest('hex');
    if (inputHash === adminPasswordHash) {
      authToken = generateToken();
      tokenExpires = Date.now() + TOKEN_TTL;
      wsBus.setAuthToken(authToken!);
      return res.json({ ok: true, token: authToken, expires: tokenExpires });
    }
    res.status(403).json({ error: '密码错误' });
  });

  app.post('/api/auth/logout', (_req, res) => {
    authToken = null;
    tokenExpires = 0;
    wsBus.setAuthToken(null);
    res.json({ ok: true });
  });

  app.get('/api/auth/check', (_req, res) => {
    res.json({ ok: !!authToken });
  });

  // ===== Agents =====
  app.get('/api/agents', (_req, res) => res.json(agentStore.listAll()));

  app.get('/api/agents/:id', (req, res) => {
    const agent = agentStore.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'not found' });
    res.json(agent);
  });

  app.post('/api/agents', (req, res) => {
    const err = validateAgent(req.body);
    if (err) return res.status(400).json({ error: err });
    agentStore.create(req.body);
    auditLog('create', 'agent', req.body.id, undefined, req.body);
    res.json({ ok: true });
  });

  app.put('/api/agents/:id', (req, res) => {
    try {
      const before = agentStore.get(req.params.id);
      agentStore.update(req.params.id, req.body);
      auditLog('update', 'agent', req.params.id, before, req.body);
      res.json({ ok: true });
    }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/agents/:id', (req, res) => {
    const before = agentStore.get(req.params.id);
    agentStore.remove(req.params.id);
    auditLog('delete', 'agent', req.params.id, before, undefined);
    res.json({ ok: true });
  });

  app.post('/api/agents/:id/toggle', (req, res) => {
    agentStore.toggle(req.params.id);
    res.json({ ok: true });
  });

  // ===== Traces =====
  app.get('/api/traces', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    res.json(traceManager.getTraces(limit, offset));
  });

  app.get('/api/traces/:traceId', (req, res) => {
    res.json(traceManager.getTrace(req.params.traceId));
  });

  // ===== Sessions =====
  app.get('/api/sessions', (_req, res) => {
    const rows = queryAll('SELECT user_id, current_agent, updated_at FROM sessions');
    res.json(rows);
  });

  app.post('/api/sessions/:userId/switch', (req, res) => {
    const { agentId } = req.body;
    const msg = agentManager.switchAgent(req.params.userId, agentId);
    res.json({ ok: true, message: msg });
  });

  // ===== Channels =====
  app.get('/api/channels', (_req, res) => res.json(channelManager.list()));

  app.get('/api/channels/:id', (req, res) => {
    const ch = channelManager.get(req.params.id);
    if (!ch) return res.status(404).json({ error: 'not found' });
    res.json(ch);
  });

  app.put('/api/channels/:id/config', (req, res) => {
    try { channelManager.updateConfig(req.params.id, req.body); res.json({ ok: true }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/channels/:id/start', async (req, res) => {
    try { await channelManager.start(req.params.id); res.json({ ok: true }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/channels/:id/stop', (req, res) => {
    try { channelManager.stop(req.params.id); res.json({ ok: true }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ===== Knowledge Base =====
  app.get('/api/knowledge/documents', (_req, res) => {
    const kbDir = path.join(cfg.data_dir, 'kb');
    if (!fs.existsSync(kbDir)) return res.json([]);
    const files = fs.readdirSync(kbDir).filter(f => /\.(txt|md)$/i.test(f));
    res.json(files.map(f => {
      const stats = fs.statSync(path.join(kbDir, f));
      return { name: f, size: stats.size, mtime: stats.mtimeMs };
    }));
  });

  app.get('/api/knowledge/chunks', (_req, res) => {
    const rows = queryAll('SELECT id, file, chunk_index, length(content) as len, created_at FROM knowledge_chunks ORDER BY id');
    res.json(rows);
  });

  app.get('/api/knowledge/chunks/:id', (req, res) => {
    const row = queryAll('SELECT * FROM knowledge_chunks WHERE id = ?', [parseInt(req.params.id)]);
    if (!row.length) return res.status(404).json({ error: 'not found' });
    res.json(row[0]);
  });

  app.delete('/api/knowledge/chunks/:id', (req, res) => {
    runStmt('DELETE FROM knowledge_chunks WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ ok: true });
  });

  app.post('/api/knowledge/upload', (req, res) => {
    let { name, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'name 和 content 必填' });
    name = path.basename(name); // 防止路径穿越
    if (!/^[\w\-. ]+$/.test(name)) return res.status(400).json({ error: '文件名包含非法字符' });
    const kbDir = path.join(cfg.data_dir, 'kb');
    if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });
    const filePath = path.join(kbDir, name.endsWith('.txt') ? name : name + '.txt');
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ ok: true, file: path.basename(filePath) });
  });

  app.delete('/api/knowledge/documents/:name', (req, res) => {
    const kbDir = path.join(cfg.data_dir, 'kb');
    const safeName = path.basename(req.params.name);
    const filePath = path.join(kbDir, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  });

  app.post('/api/knowledge/reindex', async (req, res) => {
    try {
      runStmt('DELETE FROM knowledge_chunks');
      const { KnowledgeManager } = await import('../knowledge/index.js');
      const km = new KnowledgeManager(cfg);
      await km.loadFiles();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== Tools / MCP =====
  app.get('/api/tools', (_req, res) => {
    const tools = mcpRegistry.getAllTools().map(t => ({
      name: t.name, description: t.description, parameters: t.parameters,
    }));
    res.json(tools);
  });

  app.post('/api/tools/external/connect', async (req, res) => {
    const { url, name } = req.body;
    if (!url) return res.status(400).json({ error: 'url 必填' });
    try {
      await mcpServerManager.connect(url, name || url);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/tools/external/disconnect', (_req, res) => {
    mcpServerManager.disconnectAll();
    res.json({ ok: true });
  });

  // ===== Chat (Web 端直接对话) =====
  app.post('/api/chat', async (req, res) => {
    const { text, userId } = req.body;
    if (!text) return res.status(400).json({ error: 'text 必填' });
    const uid = userId || `web_${Date.now()}`;
    try {
      const result = await agentManager.handleMessage({
        id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        platform: 'web',
        channel: 'private',
        from: { userId: uid },
        text,
        segments: [{ type: 'text', data: { text } }],
        timestamp: Date.now(),
      });
      res.json({ ok: true, reply: result, userId: uid });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== Messages =====
  app.get('/api/messages', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const userId = req.query.userId as string;
    let sql = 'SELECT * FROM messages';
    const params: any[] = [];
    if (userId) { sql += ' WHERE user_id = ?'; params.push(userId); }
    sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = queryAll(sql, params);
    res.json(rows);
  });

  app.get('/api/messages/users', (_req, res) => {
    const rows = queryAll('SELECT DISTINCT user_id, count(*) as count, max(timestamp) as last_time FROM messages GROUP BY user_id ORDER BY last_time DESC');
    res.json(rows);
  });

  // ===== Export / Import =====
  const EXPORT_TABLES = ['agents', 'sessions', 'messages', 'traces', 'knowledge_chunks', 'channels', 'long_term_memories'] as const;

  app.get('/api/export', (_req, res) => {
    const data: any = {};
    for (const table of EXPORT_TABLES) {
      data[table] = queryAll(`SELECT * FROM ${table}`);
    }
    data.exportedAt = new Date().toISOString();
    res.json(data);
  });

  const IMPORT_TABLES = new Set(['agents', 'channels']);
  const IMPORT_ALLOWED_COLUMNS: Record<string, Set<string>> = {
    agents: new Set(['id', 'name', 'enabled', 'model', 'temperature', 'max_tokens', 'system_prompt', 'persona', 'memory_config', 'greeting', 'tools', 'mcp_servers', 'route', 'created_at', 'updated_at']),
    channels: new Set(['id', 'type', 'name', 'enabled', 'config', 'status', 'created_at', 'updated_at']),
  };

  app.post('/api/import', (req, res) => {
    const data = req.body;
    if (!data || !data.agents) return res.status(400).json({ error: '无效的导入文件' });
    let imported = 0;
    for (const table of ['agents', 'channels']) {
      if (!Array.isArray(data[table])) continue;
      const allowed = IMPORT_ALLOWED_COLUMNS[table];
      if (!allowed) continue;
      for (const row of data[table]) {
        try {
          const keys = Object.keys(row).filter(k => allowed.has(k));
          if (!keys.length) continue;
          const vals = keys.map(() => '?').join(', ');
          runStmt(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${vals})`, keys.map(k => row[k]));
          imported++;
        } catch { /* skip invalid rows */ }
      }
    }
    res.json({ ok: true, imported });
  });

  // ===== Settings =====
  app.get('/api/settings/llm', (_req, res) => {
    const s = getLlmSettings();
    // 不返回完整 apiKey，只返回掩码
    const masked = s.apiKey ? `${s.apiKey.slice(0, 4)}****${s.apiKey.slice(-4)}` : '';
    res.json({ ...s, apiKey: masked, _hasKey: !!s.apiKey });
  });

  app.put('/api/settings/llm', (req, res) => {
    const { provider, apiKey, baseUrl, model, temperature } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider 必填' });
    if (!baseUrl) return res.status(400).json({ error: 'baseUrl 必填' });
    if (!model) return res.status(400).json({ error: 'model 必填' });
    // 保留已有 key（如果新提交的 key 是掩码则不动）
    const existing = getLlmSettings();
    const finalKey = (apiKey && apiKey !== '••••••••' && !/^.{4}\*{4}.{4}$/.test(apiKey)) ? apiKey : existing.apiKey;
    saveLlmSettings({
      provider, apiKey: finalKey, baseUrl, model, temperature: temperature ?? 0.7,
    });
    clearModelCache();
    res.json({ ok: true });
  });

  // ===== Model Providers =====
  app.get('/api/providers', (_req, res) => res.json(providerManager.getAll()));

  app.get('/api/providers/:id', (req, res) => {
    const p = providerManager.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json(p);
  });

  app.post('/api/providers', (req, res) => {
    try {
      const p = providerManager.create(req.body);
      auditLog('create', 'provider', p.id, undefined, req.body);
      res.json(p);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.put('/api/providers/:id', (req, res) => {
    try {
      const before = providerManager.get(req.params.id);
      providerManager.update(req.params.id, req.body);
      auditLog('update', 'provider', req.params.id, before, req.body);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/providers/:id', (req, res) => {
    const before = providerManager.get(req.params.id);
    providerManager.remove(req.params.id);
    auditLog('delete', 'provider', req.params.id, before, undefined);
    res.json({ ok: true });
  });

  app.get('/api/providers/:id/stats', (req, res) => {
    const p = providerManager.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    const tokenStats = tokenTracker.getProviderStats(req.params.id);
    const agentCount = tokenTracker.getProviderAgentCount(req.params.id);
    res.json({ provider: p, tokenStats, agentCount });
  });

  app.get('/api/providers/:id/agents', (req, res) => {
    const rows = queryAll('SELECT id, name FROM agents WHERE provider = ?', [req.params.id]);
    res.json(rows);
  });

  // ===== Health =====
  app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime(), ts: Date.now() }));

  // ===== Logs =====
  app.get('/api/logs', (req, res) => {
    try {
      const level = (req.query.level as string) || '';
      const traceId = (req.query.traceId as string) || '';
      const keyword = (req.query.q as string) || '';
      const limit = Math.min(Math.abs(parseInt(req.query.limit as string) || 100), 500);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
      const logFile = path.resolve(cfg.data_dir, 'logs', 'app.log');
      if (!fs.existsSync(logFile)) return res.json({ entries: [], total: 0 });
      const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
      const entries = lines.map(line => { try {
        const e = JSON.parse(line);
        if (e.ts) {
          const d = new Date(e.ts);
          if (!isNaN(d.getTime())) {
            const pad = (n: number, len = 2) => String(n).padStart(len, '0');
            e.ts = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          }
        }
        return e;
      } catch { return null; } }).filter(Boolean);
      let filtered = entries;
      if (level) filtered = filtered.filter((e: any) => e.level === level);
      if (traceId) filtered = filtered.filter((e: any) => e.traceId && e.traceId.startsWith(traceId));
      if (keyword) filtered = filtered.filter((e: any) =>
        (e.msg && e.msg.toLowerCase().includes(keyword.toLowerCase())) ||
        (e.traceId && e.traceId.toLowerCase().includes(keyword.toLowerCase()))
      );
      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);
      res.json({ entries: page, total });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return app;
}
