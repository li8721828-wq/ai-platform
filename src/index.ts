import { loadConfig } from './config.js';
import { initDb } from './db/sqlite.js';
import { agentManager } from './engine/agent-manager.js';
import { agentStore } from './agent-manager/store.js';
import './agent-manager/loader.js';
import { channelManager } from './channel-manager.js';
import { initKnowledgeTools } from './knowledge/tools/index.js';
import { skillRegistry } from './skill/registry.js';
import { createApp } from './web/app.js';

async function main() {
  console.log('✦ AI Platform 启动中...');

  const config = loadConfig();
  console.log(`  数据目录: ${config.data_dir}`);

  await initDb(config);
  console.log('  ✓ 数据库初始化完成');

  // 加载 Agent：config.yaml → 内存 → 同步到 SQLite
  await agentManager.init(config);
  await syncConfigAgentsToDb(config);
  console.log(`  ✓ Agent 管理器就绪 (${agentManager.getAllAgents().length} 个)`);

  // 工具和知识库
  const km = initKnowledgeTools(config);
  await km.loadFiles();
  console.log('  ✓ 知识库 + 工具注册完成');

  // Skill 插件
  await skillRegistry.loadFromDir('plugins');
  console.log('  ✓ Skill 加载完成');

  // 通道管理器（不主动连接 NapCat）
  channelManager.init();
  console.log('  ✓ 通道管理器就绪');

  // Web 管理后台
  const app = createApp(config);
  function startServer(port: number) {
    const server = app.listen(port);
    server.on('listening', () => {
      console.log(`  ✓ 管理后台: http://localhost:${port}`);
    });
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`  ! 端口 ${port} 被占用，尝试端口 ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error(`  ✗ 启动失败: ${err.message}`);
        process.exit(1);
      }
    });
  }
  startServer(config.web.port);

  console.log('✦ 启动完成，等待消息...');
}

async function syncConfigAgentsToDb(config: any) {
  for (const a of agentManager.getAllAgents()) {
    const existing = agentStore.get(a.id);
    if (!existing) {
      try {
        agentStore.create(a);
      } catch (err: any) {
        console.warn(`  ! 同步 Agent "${a.id}" 到数据库失败:`, err);
      }
    }
  }
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
