import { mcpRegistry } from '../../mcp/registry.js';
import { KnowledgeManager } from '../index.js';
import type { Config } from '../../config.js';

let km: KnowledgeManager;

export function initKnowledgeTools(cfg: Config) {
  km = new KnowledgeManager(cfg);

  mcpRegistry.register({
    name: 'retrieve_knowledge',
    description: '从知识库检索相关文档内容（RAG），返回与问题最相关的文本片段',
    parameters: {
      query: { type: 'string', description: '搜索查询' },
      top_k: { type: 'number', description: '返回结果数量（默认 3）' },
    },
    async execute(args: any) {
      const query = args.query;
      if (!query) return '请提供查询内容';
      const results = await km.retrieve(query);
      if (!results.length) return '未找到相关内容';
      return results.slice(0, args.top_k || 3).map((r, i) => `[${i + 1}] ${r}`).join('\n---\n');
    },
  });

  mcpRegistry.register({
    name: 'web_search',
    description: '搜索互联网信息，返回与查询相关的网页摘要',
    parameters: {
      query: { type: 'string', description: '搜索关键词' },
    },
    async execute(args: any) {
      throw new Error('web_search 工具尚未接入真实搜索 API，请在 .env 中配置 SEARCH_API_KEY 并重启服务');
    },
  });

  return km;
}
