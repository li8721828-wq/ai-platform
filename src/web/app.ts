import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { Config } from '../config.js';
import { agentStore } from '../agent-manager/store.js';
import { validateAgent } from '../agent-manager/validator.js';
import { traceManager } from '../tracing/manager.js';
import { agentManager } from '../engine/agent-manager.js';
import { channelManager } from '../channel-manager.js';
import { mcpRegistry } from '../mcp/registry.js';
import { mcpServerManager } from '../mcp/server.js';
import { queryAll, runStmt } from '../db/sqlite.js';

export function createApp(cfg: Config) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve('src/web/static')));

  // ===== Auth =====
  const adminPassword = cfg.admin?.password || 'admin';
  let authToken: string | null = null;
  const TOKEN_HEADER = 'x-auth-token';

  function generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  function authMiddleware(req: any, res: any, next: any) {
    if (req.path === '/api/auth/login') return next();
    if (req.path.startsWith('/api/')) {
      const token = req.headers[TOKEN_HEADER] || req.query.token;
      if (token === authToken) return next();
      return res.status(401).json({ error: '未登录，请先登录' });
    }
    next();
  }
  app.use(authMiddleware);

  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (password === adminPassword) {
      authToken = generateToken();
      return res.json({ ok: true, token: authToken });
    }
    res.status(403).json({ error: '密码错误' });
  });

  app.post('/api/auth/logout', (_req, res) => {
    authToken = null;
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
    res.json({ ok: true });
  });

  app.put('/api/agents/:id', (req, res) => {
    try { agentStore.update(req.params.id, req.body); res.json({ ok: true }); }
    catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/agents/:id', (req, res) => {
    agentStore.remove(req.params.id);
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
    const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
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
    const { name, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'name 和 content 必填' });
    const kbDir = path.join(cfg.data_dir, 'kb');
    if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });
    const filePath = path.join(kbDir, name.endsWith('.txt') ? name : name + '.txt');
    fs.writeFileSync(filePath, content, 'utf-8');
    res.json({ ok: true, file: path.basename(filePath) });
  });

  app.delete('/api/knowledge/documents/:name', (req, res) => {
    const kbDir = path.join(cfg.data_dir, 'kb');
    const filePath = path.join(kbDir, req.params.name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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

  return app;
}
