import { loadConfig } from './config.js';
import { initDb, getDb } from './db/sqlite.js';
import { agentManager } from './engine/agent-manager.js';
import { agentStore } from './agent-manager/store.js';
import { providerManager } from './provider-manager.js';
import './agent-manager/loader.js';
import { channelManager } from './channel-manager.js';
import { initKnowledgeTools } from './knowledge/tools/index.js';
import { skillRegistry } from './skill/registry.js';
import { memoryCompressor } from './memory/compressor.js';
import { createApp } from './web/app.js';
import { wsBus } from './ws-bus.js';
import { eventBus } from './event-bus.js';
import { logger } from './logger.js';
import pkg from '../package.json' with { type: 'json' };

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const RESET = '\x1b[0m';

const VERSION = pkg.version;

const banner = `
  ${CYAN}  ██████╗  ██████╗  ██████╗ ███████╗${RESET}
  ${CYAN}  ╚════██╗██╔═████╗██╔═████╗██╔════╝${RESET}
  ${CYAN}   █████╔╝██║██╔██║██║██╔██║█████╗${RESET}
  ${CYAN}   ╚═══██╗████╔╝██║████╔╝██║██╔══╝${RESET}
  ${CYAN}  ██████╔╝╚██████╔╝╚██████╔╝███████╗${RESET}
  ${CYAN}  ╚═════╝  ╚═════╝  ╚═════╝ ╚══════╝${RESET}
  ${YELLOW}  :: AI Platform :: v${VERSION}${RESET}
  ${GRAY}  Build: ${new Date().toISOString().slice(0, 10)}${RESET}
`;

async function main() {
  console.log(banner);
  const t0 = Date.now();

  logger.info('[ConfigLoader] Config loaded');
  const config = loadConfig();

  logger.info('[Database] SQLite database initialized');
  await initDb(config);
  seedProviders(config);

  const agents = agentManager.getAllAgents();
  logger.info('[Database] Providers seeded');
  logger.info('[AgentManager] Agent manager initialized', { count: agents.length });

  await agentManager.init(config);
  await syncConfigAgentsToDb(config);

  const km = initKnowledgeTools(config);
  await km.loadFiles();
  logger.info('[KnowledgeBase] Knowledge base + tools ready');

  await skillRegistry.loadFromDir('plugins');
  logger.info('[SkillRegistry] Skill plugins loaded');

  channelManager.init();
  logger.info('[ChannelManager] Channel manager ready');

  memoryCompressor.start(config);
  logger.info('[MemoryCompressor] Long-term memory compressor started');

  const app = createApp(config);
  logger.info('[WebServer] Express app created');

  function startServer(port: number) {
    const server = app.listen(port);
    server.on('listening', () => {
      wsBus.attach(server);
      wsBus.setAuthToken(null);
      eventBus.setWsBroadcast((event, data) => wsBus.broadcast(event, data));
      const url = `http://localhost:${port}`;
      const elapsed = Date.now() - t0;
      logger.info('[TomcatWebServer] Server started', { port, url, elapsed });
      const ms = `${GREEN}${elapsed}ms${RESET}`;
      console.log(`\n  ${GREEN}Started AI Platform in ${ms}${RESET}`);
      console.log(`  ${CYAN}🌐 管理后台: ${url}${RESET}`);
      if (config.admin?.password) {
        console.log(`  ${YELLOW}Login with the password from config.yaml${RESET}`);
      }
    });
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn('[TomcatWebServer] Port in use, trying next', { port });
        startServer(port + 1);
      } else {
        logger.error('[TomcatWebServer] Failed to start', { error: err.message });
        process.exit(1);
      }
    });
  }
  startServer(config.web.port);
}

async function syncConfigAgentsToDb(config: any) {
  for (const a of agentManager.getAllAgents()) {
    const existing = agentStore.get(a.id);
    if (!existing) {
      try {
        agentStore.create(a);
      } catch (err: any) {
        logger.warn('[AgentStore] Sync agent failed', { id: a.id, error: err.message });
      }
    }
  }
}

function seedProviders(config: any) {
  if (!config.providers?.length) return;
  const existing = providerManager.getAll();
  if (existing.length > 0) return;
  for (const p of config.providers) {
    providerManager.create({
      id: p.id,
      name: p.name,
      provider: p.provider,
      apiKey: p.api_key,
      baseUrl: p.base_url,
      models: p.models,
      isDefault: p.is_default ? 1 : 0,
    });
  }
}

main().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});

process.on('SIGTERM', () => { logger.info('收到 SIGTERM，优雅关闭...'); shutdown(); });
process.on('SIGINT', () => { logger.info('收到 SIGINT，优雅关闭...'); shutdown(); });

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  channelManager.stopAll();
  memoryCompressor.stop();
  getDb().close();
  logger.info('[Shutdown] Server shut down');
  process.exit(0);
}
