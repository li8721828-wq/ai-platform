import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { DynamicTool } from '@langchain/core/tools';
import { RunnableSequence } from '@langchain/core/runnables';
import type { AgentDef, UnifiedMessage } from '../types.js';
import { buildSystemMessages } from './prompt.js';
import { createModelForAgent } from './model-factory.js';
import { getSession, updateSession, addMessageToContext, getContextMessages } from '../memory/manager.js';
import { traceManager } from '../tracing/manager.js';
import { loadAgentsFromDb } from '../agent-manager/loader.js';
import { mcpRegistry } from '../mcp/registry.js';
import type { Config } from '../config.js';

class AgentManager {
  private agents = new Map<string, AgentDef>();

  async init(config: Config) {
    await this.loadFromConfig(config);
    const dbAgents = await loadAgentsFromDb();
    for (const a of dbAgents) {
      this.agents.set(a.id, a);
    }
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
        id,
        model: raw.model || raw.Model || '',
        temperature: raw.temperature ?? raw.Temperature ?? 0.7,
        maxTokens: raw.max_tokens ?? raw.maxTokens ?? raw.MaxTokens,
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

  getAgent(id: string): AgentDef | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): AgentDef[] {
    return Array.from(this.agents.values());
  }

  async reload(defs: AgentDef[]) {
    for (const def of defs) {
      if (def.enabled !== false) this.agents.set(def.id, def);
      else this.agents.delete(def.id);
    }
  }

  matchAgent(msg: UnifiedMessage): AgentDef {
    const candidates: { agent: AgentDef; score: number }[] = [];
    const text = msg.text.trim();
    for (const agent of this.agents.values()) {
      const r = agent.route;
      switch (r.type) {
        case 'command':
          if (r.commands?.some(cmd => text.startsWith(cmd)))
            candidates.push({ agent, score: (r.priority ?? 50) + 1000 });
          break;
        case 'keyword':
          if (r.keywords?.some(kw => text.includes(kw)))
            candidates.push({ agent, score: (r.priority ?? 50) + 500 });
          break;
        case 'llm_match':
          candidates.push({ agent, score: r.priority ?? 50 });
          break;
        case 'catchall':
          candidates.push({ agent, score: r.priority ?? 0 });
          break;
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.agent ?? this.agents.get('default')!;
  }

  async handleMessage(msg: UnifiedMessage): Promise<string> {
    return traceManager.trace('agent.handleMessage', async (span) => {
      span.metadata = { userId: msg.from.userId, text: msg.text.slice(0, 100) };

      let agentId = getSession(msg.from.userId).currentAgent;

      const switchMatch = msg.text.match(/^\/switch\s+(\S+)/);
      if (switchMatch) {
        agentId = switchMatch[1];
        if (!this.agents.has(agentId)) return `找不到名为 ${agentId} 的 Agent`;
        updateSession(msg.from.userId, { currentAgent: agentId });
        return this.agents.get(agentId)!.greeting || `已切换到 ${this.agents.get(agentId)!.name || agentId}`;
      }

      const agent = this.agents.get(agentId) || this.matchAgent(msg);
      if (agent.id !== agentId) updateSession(msg.from.userId, { currentAgent: agent.id });

      addMessageToContext(msg.from.userId, 'user', msg.text);

      const sysMsgs = buildSystemMessages(agent);
      const context = getContextMessages(msg.from.userId);
      const model = createModelForAgent(agent.model, {
        provider: 'deepseek', apiKey: process.env.LLM_API_KEY || '',
        baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
        model: agent.model, temperature: agent.temperature ?? 0.7,
      });

      const tools = this.resolveTools(agent);
      const modelWithTools = tools.length ? (model as any).bindTools(tools) : model;

      const messages: any[] = [
        ...sysMsgs.map(s => new SystemMessage(s)),
        ...context.map(c => {
          if (c.role === 'user') return new HumanMessage(c.text);
          if (c.role === 'tool') return new AIMessage({ content: '', tool_calls: c.toolCalls });
          return new AIMessage(c.text);
        }),
        new HumanMessage(msg.text),
      ];

      try {
        const result = await this.invokeWithTools(modelWithTools, messages, tools);
        addMessageToContext(msg.from.userId, 'assistant', result);
        return result;
      } catch (err: any) {
        const errMsg = `AI 响应失败: ${err.message}`;
        addMessageToContext(msg.from.userId, 'assistant', errMsg);
        return errMsg;
      }
    });
  }

  private resolveTools(agent: AgentDef): DynamicTool[] {
    const allTools = mcpRegistry.getAllTools();
    return allTools
      .filter(t => agent.tools.includes(t.name))
      .map(t => new DynamicTool({
        name: t.name,
        description: t.description,
        func: async (input: string) => {
          let args: any;
          try { args = JSON.parse(input); } catch { args = { input }; }
          return t.execute(args);
        },
      }));
  }

  private async invokeWithTools(model: any, messages: any[], tools: DynamicTool[]): Promise<string> {
    let response = await model.invoke(messages);

    if (response.tool_calls?.length) {
      for (const tc of response.tool_calls) {
        const tool = tools.find(t => t.name === tc.name);
        if (tool) {
          try {
            const result = await tool.func(JSON.stringify(tc.args));
            messages.push(new AIMessage({ content: '', tool_calls: [tc] }));
            messages.push(new HumanMessage({ content: result, name: tc.name }));
          } catch (err: any) {
            messages.push(new AIMessage({ content: '', tool_calls: [tc] }));
            messages.push(new HumanMessage({ content: `错误: ${err.message}`, name: tc.name }));
          }
        }
      }
      response = await model.invoke(messages);
    }

    return response.content || '';
  }

  switchAgent(userId: string, agentId: string): string {
    const agent = this.agents.get(agentId);
    if (!agent) return `找不到 Agent: ${agentId}`;
    updateSession(userId, { currentAgent: agentId });
    return agent.greeting || `已切换到 ${agent.name || agentId}`;
  }
}

export const agentManager = new AgentManager();
