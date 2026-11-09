import {
  deleteMemory,
  getMemory,
  listMemories,
  upsertMemory,
} from '../../../db/repositories/memories.js';
import { searchMessages } from '../../../db/repositories/conversations.js';
import { rankMemories } from '../../../memory/search.js';

const ACTIONS = new Set(['save', 'search', 'list', 'get', 'forget']);

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function summarizeMemory(memory) {
  return {
    key: memory.key,
    value: memory.value,
    importance: memory.importance,
    updatedAt: memory.updated_at,
  };
}

export async function handler(args = {}, context = {}) {
  const jid = context.jid;
  if (!jid) {
    return { ok: false, error: 'No chat context available for memory.' };
  }

  const action = String(args.action || 'search').toLowerCase();
  if (!ACTIONS.has(action)) {
    return { ok: false, action, error: `Unknown memory action: ${action}` };
  }

  try {
    if (action === 'save') {
      const key = String(args.key || '').trim();
      const value = String(args.value ?? '').trim();
      if (!key) return { ok: false, action, error: 'key is required to save a memory' };
      if (!value) return { ok: false, action, error: 'value is required to save a memory' };
      const importance = clampInt(args.importance, 1, 10, 5);
      const saved = await upsertMemory({ jid, key, value, importance });
      return { ok: true, action, saved: summarizeMemory(saved) };
    }

    if (action === 'search') {
      const query = String(args.query || '').trim();
      const limit = clampInt(args.limit, 1, 25, 10);
      const all = await listMemories(jid, 1000);
      const matches = query
        ? rankMemories(query, all, { limit }).map((memory) => ({
          ...summarizeMemory(memory),
          relevance: Number(memory.relevance.toFixed(3)),
        }))
        : all.slice(0, limit).map(summarizeMemory);

      let history = [];
      if (query) {
        const recent = await searchMessages(jid, query, 6);
        history = recent.map((message) => ({
          role: message.role,
          content: String(message.content || '').slice(0, 280),
          at: message.created_at,
        }));
      }

      return {
        ok: true,
        action,
        query: query || null,
        count: matches.length,
        matches,
        history,
        total: all.length,
      };
    }

    if (action === 'list') {
      const limit = clampInt(args.limit, 1, 100, 20);
      const all = await listMemories(jid, limit);
      return { ok: true, action, count: all.length, memories: all.map(summarizeMemory) };
    }

    if (action === 'get') {
      const key = String(args.key || '').trim();
      if (!key) return { ok: false, action, error: 'key is required to get a memory' };
      const memory = await getMemory(jid, key);
      if (!memory) return { ok: false, action, key, error: 'no memory stored under that key' };
      return { ok: true, action, memory: summarizeMemory(memory) };
    }

    // forget
    const key = String(args.key || '').trim();
    if (!key) return { ok: false, action, error: 'key is required to forget a memory' };
    const removed = await deleteMemory(jid, key);
    return { ok: removed, action, key, removed };
  } catch (error) {
    return { ok: false, action, error: error.message };
  }
}
