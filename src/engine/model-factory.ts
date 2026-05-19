import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

interface ModelConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

const modelCache = new Map<string, BaseChatModel>();

export function createModel(cfg: ModelConfig): BaseChatModel {
  const key = `${cfg.provider}:${cfg.model}:${cfg.temperature}`;
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
  globalCfg: ModelConfig,
  temperature?: number
): BaseChatModel {
  const cfg: ModelConfig = {
    ...globalCfg,
    model: agentModel || globalCfg.model,
    temperature: temperature ?? globalCfg.temperature,
  };
  return createModel(cfg);
}

export function clearModelCache() {
  modelCache.clear();
}
