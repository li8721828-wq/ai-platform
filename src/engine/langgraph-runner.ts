import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { DynamicTool } from '@langchain/core/tools';
import { createModelForAgent } from './model-factory.js';
import type { AgentDef } from '../types.js';
import { mcpRegistry } from '../mcp/registry.js';
import { logger } from '../logger.js';
import { tokenTracker } from '../token-tracker.js';
import { providerManager } from '../provider-manager.js';

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (name: string, args: any) => void;
  onToolResult?: (name: string, result: string) => void;
  onError?: (err: Error) => void;
  onFinish?: (text: string) => void;
}

export class LangGraphRunner {
  private activeAborts = new Map<string, AbortController>();

  async run(
    agent: AgentDef,
    sysMsgs: string[],
    context: any[],
    userText: string,
    env: any,
    callbacks?: StreamCallbacks,
    abortKey?: string,
  ): Promise<string> {
    const tools = this.resolveTools(agent);
    const model = createModelForAgent(agent.model, agent.provider, env);
    logger.info(`[LangGraph] Start`, { agent: agent.id, model: agent.model, tools: tools.map(t => t.name), contextLen: context.length });

    // Setup abort controller
    const abortKey_ = abortKey || `run_${Date.now()}`;
    if (this.activeAborts.has(abortKey_)) {
      this.activeAborts.get(abortKey_)!.abort();
    }
    const abortCtrl = new AbortController();
    this.activeAborts.set(abortKey_, abortCtrl);

    const messages: any[] = [
      ...sysMsgs.map(s => new SystemMessage(s)),
      ...context.map(c => {
        if (c.role === 'user') return new HumanMessage(c.text);
        if (c.role === 'tool' && c.toolCalls) return new AIMessage({ content: '', tool_calls: c.toolCalls });
        return new AIMessage(c.text);
      }),
      new HumanMessage(userText),
    ];

    const maxLoop = 10;
    try {
      for (let i = 0; i < maxLoop; i++) {
        if (abortCtrl.signal.aborted) return '⏸️ 推理已中断';

        if (callbacks?.onToken && i === 0) {
          const stream = await (model as any).stream(messages, { signal: abortCtrl.signal });
          logger.info(`[LangGraph] Streaming call`, { agent: agent.id, turn: i + 1 });
          let fullContent = '';
          for await (const chunk of stream) {
            if (abortCtrl.signal.aborted) break;
            const delta = chunk.content?.toString() || '';
            if (delta) {
              fullContent += delta;
              callbacks.onToken!(delta);
            }
          }
          callbacks?.onFinish?.(fullContent);
          logger.info(`[LangGraph] Streaming complete`, { agent: agent.id, replyLen: fullContent.length });
          return fullContent;
        }

        const bound = tools.length ? (model as any).bindTools(tools) : model;
        const response = await bound.invoke(messages, { signal: abortCtrl.signal });
        this.trackUsage(agent, env, response);

        if (!response.tool_calls?.length) {
          const text = response.content || '';
          callbacks?.onFinish?.(text);
          logger.info(`[LangGraph] Complete`, { agent: agent.id, turn: i + 1, replyLen: text.length });
          return text;
        }

        logger.info(`[LangGraph] Tool calls`, { agent: agent.id, turn: i + 1, toolCalls: response.tool_calls.map((tc: any) => tc.name) });
        messages.push(new AIMessage({ content: '', tool_calls: response.tool_calls }));
        for (const tc of response.tool_calls) {
          const tool = tools.find(t => t.name === tc.name);
          if (!tool) continue;
          callbacks?.onToolCall?.(tc.name, tc.args);
          let result: string;
          try {
            const argsStr = JSON.stringify(tc.args);
            result = await tool.func(argsStr);
            logger.info(`[LangGraph] Tool executed`, { tool: tc.name, args: tc.args, resultLen: result.length });
          } catch (err: any) {
            result = `错误: ${err.message}`;
            logger.error(`[LangGraph] Tool execution failed`, { tool: tc.name, args: tc.args, error: err.message, stack: err.stack });
          }
          callbacks?.onToolResult?.(tc.name, result);
          messages.push(new ToolMessage({ content: result, tool_call_id: tc.id || tc.name }));
        }
      }

      const fallback = '已达到最大推理步数(10)，请简化问题。';
      callbacks?.onFinish?.(fallback);
      return fallback;
    } catch (err: any) {
      if (err.name === 'AbortError') return '⏸️ 推理已中断';
      logger.error('[LangGraph] Run failed', { error: err.message });
      callbacks?.onError?.(err);
      throw err;
    } finally {
      this.activeAborts.delete(abortKey_);
    }
  }

  abort(key: string) {
    this.activeAborts.get(key)?.abort();
  }

  async classifyIntent(
    userText: string,
    candidates: { id: string; name: string; description: string; keywords: string[] }[],
    env: any,
  ): Promise<string | null> {
    if (!candidates.length) return null;
    if (candidates.length === 1) return candidates[0].id;

    const model = createModelForAgent('', undefined, env);

    const candidateDesc = candidates
      .map(c => `- "${c.id}": ${c.name} — ${c.description}${c.keywords.length ? ` (关键词: ${c.keywords.join(', ')})` : ''}`)
      .join('\n');

    const sysMsg = [
      '你是一个意图分类系统。根据用户输入, 从以下候选 Agent 中选择最合适的一个。',
      '只返回一个 JSON 对象: {"agentId": "所选agent的id", "confidence": 0-1}',
      '',
      '候选 Agent:',
      candidateDesc,
    ].join('\n');

    try {
      const response = await model.invoke([
        new SystemMessage(sysMsg),
        new HumanMessage(`用户消息: ${userText}`),
      ]);

      const content = response.content?.toString() || '';
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.agentId || null;
      }
    } catch {
      // fall through to keyword matching
    }

    // fallback: keyword matching
    const lower = userText.toLowerCase();
    for (const c of candidates) {
      if (c.keywords.some(k => lower.includes(k))) return c.id;
    }
    return candidates[0]?.id || null;
  }

  private resolveTools(agent: AgentDef): DynamicTool[] {
    const allTools = mcpRegistry.getAllTools();
    return allTools
      .filter(t => agent.tools.includes(t.name))
      .map(t => new DynamicTool({
        name: t.name, description: t.description,
        func: async (input: string) => {
          let args: any;
          try { args = JSON.parse(input); } catch { args = { input }; }
          return t.execute(args);
        },
      }));
  }

  private trackUsage(agent: AgentDef, env: any, response: any) {
    try {
      const meta = response.response_metadata;
      if (!meta?.token_usage) return;
      const tu = meta.token_usage;
      const providerId = agent.provider || providerManager.getDefault()?.id || 'unknown';
      tokenTracker.record({
        providerId,
        model: agent.model || env.model,
        promptTokens: tu.prompt_tokens || 0,
        completionTokens: tu.completion_tokens || 0,
        totalTokens: tu.total_tokens || 0,
        agentId: agent.id,
      });
    } catch { /* ignore tracking errors */ }
  }
}

export const langGraphRunner = new LangGraphRunner();
