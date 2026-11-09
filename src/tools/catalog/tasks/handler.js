import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  searchTasks,
  updateTask,
} from '../../../db/repositories/tasks.js';

const ACTIONS = new Set(['create', 'list', 'search', 'update', 'complete', 'delete', 'get']);

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseDueAt(value) {
  if (value === null || value === undefined) return { dueAt: null };
  const raw = String(value).trim();
  if (!raw) return { dueAt: null };
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { error: `Could not parse dueAt: ${raw}. Use ISO-8601, for example 2026-02-14T09:00:00+01:00.` };
  }
  return { dueAt: date.toISOString() };
}

function summarizeTask(task) {
  return {
    id: task.id,
    title: task.title,
    details: task.details || null,
    dueAt: task.due_at || null,
    status: task.status,
    priority: task.priority,
    tags: Array.isArray(task.tags) ? task.tags : [],
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

export async function handler(args = {}, context = {}) {
  const jid = context.jid;
  if (!jid) {
    return { ok: false, error: 'No chat context available for tasks.' };
  }

  const action = String(args.action || 'list').toLowerCase();
  if (!ACTIONS.has(action)) {
    return { ok: false, action, error: `Unknown tasks action: ${action}` };
  }

  try {
    if (action === 'create') {
      const title = String(args.title || '').trim();
      if (!title) return { ok: false, action, error: 'title is required to create a task' };
      const parsed = parseDueAt(args.dueAt);
      if (parsed.error) return { ok: false, action, error: parsed.error };
      const task = await createTask({
        jid,
        title,
        details: args.details ?? null,
        dueAt: parsed.dueAt,
        priority: clampInt(args.priority, 1, 3, 2),
        tags: Array.isArray(args.tags) ? args.tags : [],
      });
      return { ok: true, action, task: summarizeTask(task) };
    }

    if (action === 'list') {
      const limit = clampInt(args.limit, 1, 100, 20);
      const all = await listTasks(jid);
      const open = all.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
      return {
        ok: true,
        action,
        count: Math.min(open.length, limit),
        open: open.length,
        tasks: open.slice(0, limit).map(summarizeTask),
      };
    }

    if (action === 'search') {
      const query = String(args.query || '').trim();
      const limit = clampInt(args.limit, 1, 100, 20);
      const rows = await searchTasks(jid, query);
      return {
        ok: true,
        action,
        query: query || null,
        count: Math.min(rows.length, limit),
        tasks: rows.slice(0, limit).map(summarizeTask),
      };
    }

    const id = clampInt(args.id, 1, Number.MAX_SAFE_INTEGER, 0);
    if (!id) return { ok: false, action, error: 'id is required for get, update, complete, and delete' };

    if (action === 'get') {
      const task = await getTask(jid, id);
      if (!task) return { ok: false, action, id, error: 'no task with that id' };
      return { ok: true, action, task: summarizeTask(task) };
    }

    if (action === 'complete') {
      const task = await completeTask(jid, id);
      if (!task) return { ok: false, action, id, error: 'no task with that id' };
      return { ok: true, action, task: summarizeTask(task) };
    }

    if (action === 'update') {
      const parsed = args.dueAt !== undefined ? parseDueAt(args.dueAt) : { dueAt: undefined };
      if (parsed.error) return { ok: false, action, error: parsed.error };
      const patch = {
        title: args.title,
        details: args.details,
        priority: args.priority !== undefined ? clampInt(args.priority, 1, 3, 2) : undefined,
        status: args.status,
        tags: Array.isArray(args.tags) ? args.tags : undefined,
      };
      if (args.dueAt !== undefined) patch.dueAt = parsed.dueAt;
      Object.keys(patch).forEach((key) => patch[key] === undefined && delete patch[key]);
      const task = await updateTask(jid, id, patch);
      if (!task) return { ok: false, action, id, error: 'no task with that id' };
      return { ok: true, action, task: summarizeTask(task) };
    }

    // delete
    const removed = await deleteTask(jid, id);
    return { ok: removed, action, id, removed };
  } catch (error) {
    return { ok: false, action, error: error.message };
  }
}
