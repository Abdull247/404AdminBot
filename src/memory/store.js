import { appConfig } from '../config/load-config.js';
import { addMessage, getRecentMessages } from '../db/repositories/conversations.js';
import { listMemories } from '../db/repositories/memories.js';
import { upsertUser } from '../db/repositories/users.js';

export async function rememberUser(jid, pushName) {
  return upsertUser(jid, pushName);
}

export async function saveTurn(jid, role, content, metadata = {}) {
  if (!appConfig.memory.enabled) return null;
  return addMessage({ jid, role, content, metadata });
}

export async function loadContext(jid) {
  if (!appConfig.memory.enabled) {
    return { history: [], memories: [] };
  }

  const memoryLimit = Number.parseInt(appConfig.memory.injectTopMemories, 10)
    || appConfig.memory.maxMemoriesPerUser;

  const [history, memories] = await Promise.all([
    getRecentMessages(jid, appConfig.memory.maxHistoryMessages),
    listMemories(jid, memoryLimit),
  ]);

  return { history, memories };
}

export function formatMemories(memories) {
  if (!memories.length) return '';
  const lines = memories.map((item) => `- ${item.key}: ${item.value}`);
  return `Things you already remember about the boss (highest importance first). Use the memory tool to search for more:\n${lines.join('\n')}`;
}
