import { getPersistenceConfig } from '../config/persistence.js';
import {
  cancelChatJob,
  inspectJob,
  inspectLogs,
  inspectResult,
  listChatJobs,
  persistenceAvailable,
} from '../persistence/manager.js';
import { commandPrefix } from './prefix.js';

function parseArg(arg) {
  const raw = String(arg || '').trim();
  if (!raw) return { action: 'list', id: '' };
  const parts = raw.split(/\s+/);
  const first = parts[0].toLowerCase();
  const actions = new Set(['list', 'logs', 'log', 'result', 'results', 'cancel', 'stop', 'status', 'check']);
  if (actions.has(first)) {
    const action = first === 'log' ? 'logs' : first === 'results' ? 'result' : first === 'stop' ? 'cancel' : first === 'check' ? 'status' : first;
    return { action, id: parts.slice(1).join(' ').trim() };
  }
  return { action: 'status', id: raw };
}

export async function handlePersistence(context) {
  const { jid, arg } = context;
  if (!persistenceAvailable()) {
    return 'Persistent agents are off. Enable supports_persistence_agent on a sandbox in sandboxes.json.';
  }
  const parsed = parseArg(arg);
  if (parsed.action === 'list') return listChatJobs(jid);
  if (!parsed.id) {
    const command = getPersistenceConfig().command;
    const prefix = commandPrefix(context);
    return `Give a job id, for example ${prefix}${command} logs jen-...`;
  }
  if (parsed.action === 'logs') return inspectLogs(jid, parsed.id);
  if (parsed.action === 'result') return inspectResult(jid, parsed.id);
  if (parsed.action === 'cancel') return cancelChatJob(jid, parsed.id);
  return inspectJob(jid, parsed.id);
}
