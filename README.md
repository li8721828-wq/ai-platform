# ✦ AI Platform

多功能 AI 消息平台，支持多 Agent 角色管理、RAG 知识库、MCP 工具系统、Skill 插件、QQ 通道（NapCat）和 Web 管理后台。

## 快速开始

```bash
# 安装依赖
npm install

# 配置 LLM API Key
# 编辑 config.yaml，填入 llm.api_key

# 启动
npm start
# 或开发模式（热重载）
npm run dev
```

启动后访问 [http://localhost:3000](http://localhost:3000) 进入管理后台。

## 功能模块

| 模块 | 说明 |
|------|------|
| 🤖 **Agent 管理** | 多角色 AI，自由增删改查，切换路由策略 |
| 📡 **通道管理** | NapCat QQ 通道的配置与连接/断开 |
| 📚 **知识库** | 文档上传、自动分块、向量检索（RAG） |
| 🔧 **工具管理** | MCP 工具注册表，支持外部 MCP Server |
| 📋 **追踪日志** | AI 调用链路 Span 追踪，定位问题 |
| 💬 **会话管理** | 用户会话与 Agent 切换 |

## 架构概览

```
QQ消息 → NapCat → Agent路由 → 人设渲染 + 上下文 → LangChain + MCP工具 → LLM → 回复
```

- 单进程 Express 服务，零外部中间件
- 存储：SQLite（sql.js）+ 文件系统
- LLM 框架：LangChain
- 包体积：~3000 行 TypeScript

## 配置

编辑 `config.yaml`：

```yaml
llm:
  api_key: sk-your-api-key          # LLM API 密钥
  base_url: https://api.deepseek.com/v1
  model: deepseek-chat

agents:
  assistant:
    model: deepseek-chat
    temperature: 0.8
    system_prompt: 你是用户的私人助手
    persona:                          # 人设系统
      name: 小星
      personality: [温柔, 耐心, 幽默]
    route:
      type: catchall
      priority: 5

knowledge:
  chunk_size: 512
  top_k: 5

web:
  port: 3000
```

## 项目结构

```
src/
├── index.ts                    # 入口
├── engine/                     # LLM 编排
│   ├── agent-manager.ts        # Agent 路由 + 工具绑定
│   ├── model-factory.ts        # 模型工厂
│   └── prompt.ts               # 提示词构建
├── agent-manager/              # Agent CRUD
├── knowledge/                  # 知识库 RAG
├── mcp/                        # 工具注册表 + 外部 Server
├── memory/                     # 会话记忆
├── tracing/                    # 链路追踪
├── skill/                      # 插件系统
├── adapters/                   # 消息通道(NapCat)
└── web/                        # 管理后台
```

## 示例插件

`plugins/weather/index.js` — 天气查询 Skill：

```js
export function match(text) {
  return ['天气', '温度'].some(kw => text.includes(kw));
}
export function execute(text) {
  // 返回模拟天气数据
}
```

## 数据库

全部数据存储于 `data/app.db`（SQLite），包含 7 张表：
agents, sessions, messages, traces, knowledge_chunks, channels, long_term_memories

## 技术栈

- **运行时**：Node.js 24+
- **语言**：TypeScript
- **Web 框架**：Express
- **AI 框架**：LangChain
- **数据库**：sql.js（纯 JS SQLite）
- **消息通道**：NapCat (WebSocket)

## License

MIT
