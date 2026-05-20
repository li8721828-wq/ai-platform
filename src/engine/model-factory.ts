import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { providerManager } from '../provider-manager.js';

interface ModelConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

const modelCache = new Map<string, BaseChatModel>();

export function createModel(cfg: ModelConfig): BaseChatModel {
  const key = `${cfg.provider}:${cfg.apiKey}:${cfg.baseUrl}:${cfg.model}:${cfg.temperature}`;
  if (modelCache.has(key)) return modelCache.get(key)!;

  const model = new ChatOpenAI({
    apiKey: cfg.apiKey,
    configuration: { baseURL: cfg.baseUrl },
    modelName: cfg.model,
    temperature: cfg.temperature,
    maxRetries: 2,
  });

  modelCache.set(key, model);
  return model;
}

export function createModelForAgent(
  agentModel: string,
  agentProviderId: string | undefined,
  globalCfg: ModelConfig,
  temperature?: number
): BaseChatModel {
  let cfg = { ...globalCfg, model: agentModel || globalCfg.model, temperature: temperature ?? globalCfg.temperature };

  if (agentProviderId) {
    const prov = providerManager.get(agentProviderId);
    if (prov && prov.apiKey) {
      const models = safeParseModels(prov.models);
      cfg = {
        provider: prov.provider,
        apiKey: prov.apiKey,
        baseUrl: prov.baseUrl,
        model: agentModel || models[0] || globalCfg.model,
        temperature: temperature ?? globalCfg.temperature,
      };
    }
  }

  return createModel(cfg);
}

export function clearModelCache() {
  modelCache.clear();
}

function safeParseModels(val: string): string[] {
  try { return JSON.parse(val); } catch { return []; }
}
