import type { AgentDef, UnifiedMessage } from '../types.js';
import { buildSystemMessages } from './prompt.js';
import { getSession, updateSession, addMessageToContext, getContextMessages } from '../memory/manager.js';
import { traceManager } from '../tracing/manager.js';
import { loadAgentsFromDb } from '../agent-manager/loader.js';
import { skillRegistry } from '../skill/registry.js';
import { memoryCompressor } from '../memory/compressor.js';
import { langGraphRunner } from './langgraph-runner.js';
import { providerManager } from '../provider-manager.js';
import { logger } from '../logger.js';
import type { Config } from '../config.js';

class AgentManager {
  private agents = new Map<string, AgentDef>();

  async init(config: Config) {
    await this.loadFromConfig(config);
    const dbAgents = await loadAgentsFromDb();
    for (const a of dbAgents) this.agents.set(a.id, a);
    if (!this.agents.has('default')) {
      this.agents.set('default', {
        id: 'default', model: config.llm.model, temperature: config.llm.temperature,
        systemPrompt: '你是 AI 助手，使用工具回答用户问题。请用中文回复。',
        tools: [], mcpServers: [], route: { type: 'catchall' },
      });
    }
  }

  private async loadFromConfig(config: Config) {
    for (const [id, def] of Object.entries(config.agents)) {
      const raw = def as any;
      this.agents.set(id, {
        id, model: raw.model || raw.Model || '',
        provider: raw.provider ?? raw.Provider,
        temperature: raw.temperature ?? raw.Temperature ?? 0.7,
        maxTokens: raw.max_tokens ?? raw.maxTokens ?? raw.MaxTokens,
        systemPrompt: ((raw.system_prompt ?? raw.systemPrompt) ?? raw.SystemPrompt) || '',
        persona: raw.persona ?? raw.Persona,
        memory: raw.memory ?? raw.memory_config ?? raw.Memory,
        greeting: raw.greeting ?? raw.Greeting,
        tools: raw.tools ?? raw.Tools ?? [],
        mcpServers: raw.mcp_servers ?? raw.mcpServers ?? raw.McpServers ?? [],
        route: raw.route ?? raw.Route ?? { type: 'catchall' },
        enabled: raw.enabled ?? raw.Enabled ?? true,
        name: raw.name ?? raw.Name,
      } as AgentDef);
    }
  }

  getAgent(id: string): AgentDef | undefined { return this.agents.get(id); }
  getAllAgents(): AgentDef[] { return Array.from(this.agents.values()); }

  async reload(defs: AgentDef[]) {
    for (const def of defs) {
      if (def.enabled !== false) this.agents.set(def.id, def);
      else this.agents.delete(def.id);
    }
  }

  async matchAgent(msg: UnifiedMessage): Promise<AgentDef> {
    const candidates: { agent: AgentDef; score: number }[] = [];
    const text = msg.text.trim();

    // Phase 1: command / keyword 精确匹配
    for (const agent of this.agents.values()) {
      const r = agent.route;
      if (r.type === 'command' && r.commands?.some(cmd => text.startsWith(cmd)))
        candidates.push({ agent, score: (r.priority ?? 50) + 1000 });
      if (r.type === 'keyword' && r.keywords?.some(kw => text.includes(kw)))
        candidates.push({ agent, score: (r.priority ?? 50) + 500 });
    }
    if (candidates.length) {
      candidates.sort((a, b) => b.score - a.score);
      const chosen = candidates[0];
      logger.info(`[AgentManager] Exact match`, { agent: chosen.agent.id, score: chosen.score, text: text.slice(0, 60) });
      return chosen.agent;
    }

    // Phase 2: llm_match — 用 LLM 判断
    const llmCandidates = Array.from(this.agents.values()).filter(a => {
      const r = a.route;
      return r.type === 'llm_match' || r.type === 'catchall';
    });
    if (llmCandidates.length > 1) {
      const effective = providerManager.getEffectiveConfig();
      const candidates = llmCandidates.map(a => ({
        id: a.id,
        name: a.persona?.name || a.name || a.id,
        description: (a.systemPrompt || '').slice(0, 100),
        keywords: extractKeywords(a),
      }));
      const env = { provider: effective?.provider || 'deepseek', apiKey: effective?.apiKey || '', baseUrl: effective?.baseUrl || 'https://api.deepseek.com/v1', model: '', temperature: 0.3 };
      logger.info(`[AgentManager] LLM intent classification`, { candidates: candidates.map(c => c.id), text: text.slice(0, 60) });
      const bestId = await langGraphRunner.classifyIntent(text, candidates, env);
      if (bestId) {
        const best = this.agents.get(bestId);
        if (best) {
          logger.info(`[AgentManager] LLM classified`, { agent: bestId, text: text.slice(0, 60) });
          return best;
        }
      }
      logger.warn(`[AgentManager] LLM classification returned no result`, { bestId, text: text.slice(0, 60) });
    }

    // Phase 3: catchall 兜底
    for (const agent of this.agents.values()) {
      if (agent.route.type === 'catchall')
        candidates.push({ agent, score: agent.route.priority ?? 0 });
    }
    candidates.sort((a, b) => b.score - a.score);
    const fallback = candidates[0]?.agent ?? this.agents.get('default')!;
    logger.info(`[AgentManager] Fallback matched`, { agent: fallback.id, text: text.slice(0, 60) });
    return fallback;
  }

  async handleMessage(msg: UnifiedMessage): Promise<string> {
    return traceManager.trace('agent.handleMessage', async (span) => {
      span.metadata = { userId: msg.from.userId, text: msg.text.slice(0, 100) };
      logger.info(`[AgentManager] Message received`, { userId: msg.from.userId, text: msg.text.slice(0, 100), platform: msg.platform });

      let agentId = getSession(msg.from.userId).currentAgent;

      const switchMatch = msg.text.match(/^\/switch\s+(\S+)/);
      if (switchMatch) {
        agentId = switchMatch[1];
        if (!this.agents.has(agentId)) {
          const errReply = `找不到名为 ${agentId} 的 Agent`;
          addMessageToContext(msg.from.userId, 'user', msg.text);
          addMessageToContext(msg.from.userId, 'assistant', errReply);
          logger.warn(`[AgentManager] Switch agent failed`, { agentId, userId: msg.from.userId });
          return errReply;
        }
        updateSession(msg.from.userId, { currentAgent: agentId });
        const reply = this.agents.get(agentId)!.greeting || `已切换到 ${this.agents.get(agentId)!.name || agentId}`;
        addMessageToContext(msg.from.userId, 'user', msg.text);
        addMessageToContext(msg.from.userId, 'assistant', reply);
        logger.info(`[AgentManager] Switched agent`, { agentId, userId: msg.from.userId });
        return reply;
      }

      const skillResult = await skillRegistry.execute(msg.text, { userId: msg.from.userId, logger: logger.child('Skill') });
      if (skillResult) {
        addMessageToContext(msg.from.userId, 'user', msg.text);
        addMessageToContext(msg.from.userId, 'assistant', skillResult);
        logger.info(`[AgentManager] Skill executed`, { userId: msg.from.userId, text: msg.text.slice(0, 60) });
        return skillResult;
      }

      const agent = this.agents.get(agentId) || await this.matchAgent(msg);
      if (agent.id !== agentId) updateSession(msg.from.userId, { currentAgent: agent.id });

      addMessageToContext(msg.from.userId, 'user', msg.text);
      logger.info(`[AgentManager] Route to agent`, { agent: agent.id, userId: msg.from.userId });

      try {
        const sysMsgs = buildSystemMessages(agent);
        const context = getContextMessages(msg.from.userId);
        const effective = providerManager.getEffectiveConfig(agent.provider);
        if (!effective || !effective.apiKey) {
          const errMsg = '⚠️ 大模型 API Key 未配置，请在「模型供应商」页面添加';
          addMessageToContext(msg.from.userId, 'assistant', errMsg);
          logger.warn(`[AgentManager] No valid API key`, { agent: agent.id, provider: agent.provider });
          return errMsg;
        }
        logger.info(`[AgentManager] Calling LLM`, { agent: agent.id, model: agent.model, provider: effective.provider });
        const result = await langGraphRunner.run(agent, sysMsgs, context, msg.text, {
          provider: effective.provider, apiKey: effective.apiKey,
          baseUrl: effective.baseUrl, model: agent.model,
          temperature: agent.temperature ?? 0.7,
        });
        addMessageToContext(msg.from.userId, 'assistant', result);
        memoryCompressor.addMemory(msg.from.userId, agent.id, `问: ${msg.text}\n答: ${result.slice(0, 200)}`);
        logger.info(`[AgentManager] LLM response completed`, { userId: msg.from.userId, agent: agent.id, replyLen: result.length });
        return result;
      } catch (err: any) {
        const errMsg = `AI 响应失败: ${err.message}`;
        addMessageToContext(msg.from.userId, 'assistant', errMsg);
        logger.error(`[AgentManager] LLM call exception`, { agent: agent.id, error: err.message, stack: err.stack, userId: msg.from.userId });
        return errMsg;
      }
    });
  }

  switchAgent(userId: string, agentId: string): string {
    const agent = this.agents.get(agentId);
    if (!agent) return `找不到 Agent: ${agentId}`;
    updateSession(userId, { currentAgent: agentId });
    return agent.greeting || `已切换到 ${agent.name || agentId}`;
  }
}

function extractKeywords(a: AgentDef): string[] {
  const words: string[] = [];
  if (a.persona?.likes) words.push(...a.persona.likes);
  if (a.route.type === 'command' && a.route.commands) words.push(...a.route.commands.map((c: string) => c.replace(/^\//, '')));
  const known = ['代码', '编程', '天气', '翻译', '搜索', '文件', '音乐', '聊天', '帮助'];
  const lower = (a.systemPrompt + ' ' + (a.persona?.name || '') + ' ' + (a.persona?.personality || []).join(' ')).toLowerCase();
  for (const k of known) {
    if (lower.includes(k)) words.push(k);
  }
  return words;
}

export const agentManager = new AgentManager();
