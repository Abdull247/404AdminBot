import { sql } from '../client.js';
import { jsonSafe, stripLoneSurrogates } from '../../utils/text.js';

const STATUSES = new Set(['pending', 'in_progress', 'done', 'cancelled']);

export const TASK_STATUSES = [...STATUSES];

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = stripLoneSurrogates(String(value)).trim();
  return text ? text : null;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => stripLoneSurrogates(String(tag ?? '')).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

export async function createTask({
  jid,
  title,
  details = null,
  dueAt = null,
  priority = 2,
  status = 'pending',
  tags = [],
  metadata = {},
}) {
  const rows = await sql`
    INSERT INTO tasks (jid, title, details, due_at, status, priority, tags, metadata)
    VALUES (
      ${jid},
      ${cleanText(title)},
      ${cleanText(details)},
      ${dueAt || null},
      ${STATUSES.has(status) ? status : 'pending'},
      ${Number.parseInt(priority, 10) || 2},
      ${jsonSafe(normalizeTags(tags))}::jsonb,
      ${jsonSafe(metadata)}::jsonb
    )
    RETURNING *
  `;
  return rows[0];
}

export async function getTask(jid, id) {
  const rows = await sql`
    SELECT *
    FROM tasks
    WHERE jid = ${jid} AND id = ${id}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function listTasks(jid) {
  return sql`
    SELECT *
    FROM tasks
    WHERE jid = ${jid}
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'in_progress' THEN 1
        WHEN 'done' THEN 2
        ELSE 3
      END,
      due_at ASC NULLS LAST,
      priority ASC,
      created_at DESC
    LIMIT 200
  `;
}

export async function searchTasks(jid, query) {
  const needle = String(query || '').trim();
  if (!needle) return listTasks(jid);
  const like = `%${needle}%`;
  return sql`
    SELECT *
    FROM tasks
    WHERE jid = ${jid}
      AND (title ILIKE ${like} OR details ILIKE ${like})
    ORDER BY
      CASE status
        WHEN 'pending' THEN 0
        WHEN 'in_progress' THEN 1
        WHEN 'done' THEN 2
        ELSE 3
      END,
      due_at ASC NULLS LAST,
      created_at DESC
    LIMIT 100
  `;
}

export async function updateTask(jid, id, patch = {}) {
  const existing = await getTask(jid, id);
  if (!existing) return null;

  const status = STATUSES.has(patch.status) ? patch.status : existing.status;
  const title = patch.title !== undefined ? cleanText(patch.title) : existing.title;
  const details = patch.details !== undefined ? cleanText(patch.details) : existing.details;
  const dueAt = patch.dueAt !== undefined ? (patch.dueAt || null) : existing.due_at;
  const priority = patch.priority !== undefined
    ? (Number.parseInt(patch.priority, 10) || existing.priority)
    : existing.priority;
  const tags = patch.tags !== undefined ? normalizeTags(patch.tags) : existing.tags;
  const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;
  const completedAt = status === 'done'
    ? (existing.completed_at || new Date())
    : null;

  const rows = await sql`
    UPDATE tasks SET
      title = ${title},
      details = ${details},
      due_at = ${dueAt},
      status = ${status},
      priority = ${priority},
      tags = ${jsonSafe(tags)}::jsonb,
      metadata = ${jsonSafe(metadata)}::jsonb,
      completed_at = ${completedAt},
      updated_at = NOW()
    WHERE jid = ${jid} AND id = ${id}
    RETURNING *
  `;
  return rows[0] || null;
}

export async function completeTask(jid, id) {
  return updateTask(jid, id, { status: 'done' });
}

export async function deleteTask(jid, id) {
  const rows = await sql`
    DELETE FROM tasks
    WHERE jid = ${jid} AND id = ${id}
    RETURNING id
  `;
  return Boolean(rows[0]);
}
