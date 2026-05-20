# AI Platform — 会话摘要

## 版本
v1.1.1（三位数版本：major.minor.patch）

## 项目结构
```
ai-platform/
├── config.yaml                    # 主配置 (LLM/Agents/Providers/Web/Admin)
├── scripts/
│   └── kill-port.mjs             # 杀端口脚本 (npm run kill)
├── src/
│   ├── index.ts                  # 启动入口
│   ├── logger.ts                 # 核心日志 (7级/脱敏/上下文/保留策略)
│   ├── advanced-logger.ts        # 高级日志 (chalk/boxen/ora)
│   ├── trace-context.ts          # 链路追踪 AsyncLocalStorage
│   ├── audit-log.ts              # 审计日志 (before/after)
│   ├── config.ts                 # YAML 配置加载
│   ├── event-bus.ts              # TypedEventBus
│   ├── provider-manager.ts       # 供应商 CRUD
│   ├── token-tracker.ts          # Token 用量追踪
│   ├── settings.ts               # LLM 设置
│   ├── utils.ts                  # 工具函数
│   ├── ws-bus.ts                 # WebSocket 总线
│   ├── db/
│   │   └── sqlite.ts             # SQLite (sql.js) 初始化与查询
│   ├── engine/
│   │   ├── agent-manager.ts      # Agent 路由匹配 + 消息处理
│   │   ├── langgraph-runner.ts   # LangGraph ReAct 循环
│   │   ├── model-factory.ts      # 模型工厂 (Provider 感知)
│   │   └── prompt.ts             # 系统提示词构造
│   ├── agent-manager/
│   │   ├── store.ts              # Agent CRUD + 日志
│   │   ├── loader.ts             # 从 DB 加载 Agent
│   │   └── validator.ts          # Agent 校验
│   ├── knowledge/
│   │   ├── index.ts              # KnowledgeManager (分块/嵌入/检索)
│   │   ├── embedder-ollama.ts    # Ollama 嵌入 (退避重试)
│   │   └── tools/
│   │       └── index.ts          # 知识库工具注册
│   ├── mcp/
│   │   ├── registry.ts           # MCP 工具注册
│   │   └── server.ts             # MCP WebSocket 客户端
│   ├── memory/
│   │   ├── manager.ts            # 会话/消息编排
│   │   ├── session-store.ts      # 会话持久化
│   │   ├── message-store.ts      # 消息持久化
│   │   └── compressor.ts         # 长期记忆压缩
│   ├── skill/
│   │   └── registry.ts           # Skill 插件加载 (ESM + VM 沙箱)
│   ├── tracing/
│   │   └── manager.ts            # 链路追踪采样 + 批写入
│   ├── adapters/
│   │   └── napcat.ts             # NapCat QQ 适配器
│   ├── channel-manager.ts        # 通道管理器 (IChannelAdapter)
│   └── web/
│       ├── app.ts                # Express API (所有路由)
│       └── static/
│           └── index.html        # 管理后台 UI (12 个标签页)
├── plugins/
│   └── weather/
│       └── index.mjs             # 示例 Skill 插件
├── tests/
│   ├── logger.test.ts            # 日志单元测试
│   └── utils.test.ts             # 工具函数测试
├── .env.example                  # 环境变量模板
├── vitest.config.ts
└── package.json
```

## 当前状态

### 已完成
- **链路追踪**: `AsyncLocalStorage` 自动 traceId/spanId，Express 中间件注入，`x-trace-id` 请求头传递
- **审计日志**: Provider/Agent CRUD 自动记录 `before/after`，敏感字段白名单过滤
- **日志系统**: 7 级日志 (trace/debug/info/warn/error/fatal/audit)，敏感数据脱敏 (apiKey→[REDACTED])，上下文自动注入 (traceId/userId/agentId)，保留策略 (maxFiles+maxAgeDays 自动清理)，AstrBot 格式 (emoji+level+component+msg+key:val)
- **高级 Logger**: chalk/boxen/ora 支持 `.task()` spinner、`.decision()` boxen 边框、`.success()` 绿色勾
- **Provider 管理**: 完整 CRUD，`getEffectiveConfig()` 多级回退，Token 用量统计
- **Agent 管理**: 路由匹配 (command/keyword/llm_match/catchall)，LangGraph ReAct 循环，Streaming + Abort
- **知识库**: 文件加载/分块/Ollama 嵌入/余弦相似度检索
- **MCP 工具**: WebSocket 连接外部 MCP 服务器
- **Skill 插件**: ESM + VM 沙箱双模式加载
- **频道管理**: IChannelAdapter 接口，NapCat 注册
- **Web 管理后台**: 12 个标签页，含运行日志 (traceId/关键词搜索/级别过滤/AUDIT)
- **UI 日志**: 早到晚排序，首次打开/点击标签页自动滚到底部，自动刷新时跟随

### 待办
- Streaming SSE → WebSocket 实时推送到 UI
- Provider 健康检查（定期 ping）
- 插件热重载
- 结构化输出解析（JSON mode 扩展至工具参数校验）

## 关键决策
| 决策 | 选择 |
|---|---|
| 数据库 | sql.js (纯 JS, 无原生编译) |
| 认证 | SHA-256 密码 + 内存 token |
| 日志 | Transport 架构 (Console + File)，JSON 行格式 |
| 嵌入 | Ollama (可配置 `embed_base_url`) |
| Provider 配置 | DB 存储，config.yaml 首次播种 |
| 日志文件 | `data/logs/app.log`, JSON lines, 10MB 轮转 |
| Module | ESM (`"type": "module"`) |

## 启动方式
```bash
npm run kill     # 杀旧进程
npm run build    # tsc 编译
npm run start    # node dist/index.js
npm run restart  # kill + build + start
npm run dev      # tsx watch src/index.ts
npm test         # vitest run (14 tests)
```

## 日志格式
```
ℹ INFO ConfigLoader Config loaded
ℹ INFO Knowledge Computing embeddings (total: 21)
⚠ WARN TomcatWebServer Port in use, trying next (port: 3000)
📋 AUDIT [Audit] create provider #prov_xxx (action: create, resource: provider)

[
  ts: ISO 8601,
  level: info|warn|error|audit,
  msg: string (通常 [Component] message),
  traceId: string,
  spanId: string,
  userId?: string,
  agentId?: string,
  duration_ms?: number,
  error?: { name, message, stack },
  audit?: { action, resource, resourceId, before, after, performedBy },
  meta?: Record<string, unknown>
]
```

## 当前版本历史
- `1.0.0` — 初始版本
- `1.1.0` — 链路追踪 + 审计日志 + 日志 Schema 标准化 + 脱敏 + 保留策略 + UI 搜索
- `1.1.1` — 三位数版本格式 + UI 日志滚动定位修复
