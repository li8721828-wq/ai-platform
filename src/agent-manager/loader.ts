import { agentStore } from './store.js';
import { agentManager } from '../engine/agent-manager.js';
import { eventBus } from '../event-bus.js';

export async function loadAgentsFromDb() {
  return agentStore.list();
}

eventBus.on('agents:changed', async () => {
  const defs = agentStore.list();
  await agentManager.reload(defs);
});
