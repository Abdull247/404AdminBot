import { sql } from '../client.js';
import { jsonSafe } from '../../utils/text.js';

export async function createStoredFile({
  id,
  jid,
  chatType = 'dm',
  filename,
  key,
  url = null,
  mimetype = null,
  size = null,
  source = 'upload',
  metadata = {},
}) {
  const rows = await sql`
    INSERT INTO stored_files (id, jid, chat_type, filename, key, url, mimetype, size, source, metadata)
    VALUES (${id}, ${jid}, ${chatType}, ${filename}, ${key}, ${url}, ${mimetype}, ${size}, ${source}, ${jsonSafe(metadata)}::jsonb)
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function listStoredFiles(jid, { limit = 30 } = {}) {
  return sql`
    SELECT * FROM stored_files
    WHERE jid = ${jid}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getStoredFile(id, jid) {
  const rows = await sql`
    SELECT * FROM stored_files
    WHERE id = ${id} AND jid = ${jid}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findStoredFileByName(jid, filename) {
  const rows = await sql`
    SELECT * FROM stored_files
    WHERE jid = ${jid} AND filename = ${filename}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function deleteStoredFile(id, jid) {
  const rows = await sql`
    DELETE FROM stored_files
    WHERE id = ${id} AND jid = ${jid}
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function listFilesForAdmin({ mimetypePrefix = null, excludePrefixes = [], limit = 1000 } = {}) {
  const parts = [];
  const params = [];
  if (mimetypePrefix) {
    parts.push(`mimetype LIKE $${params.length + 1}`);
    params.push(`${mimetypePrefix}%`);
  }
  for (const prefix of excludePrefixes) {
    parts.push(`mimetype NOT LIKE $${params.length + 1}`);
    params.push(`${prefix}%`);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const query = `SELECT * FROM stored_files ${where} ORDER BY created_at DESC LIMIT ${Math.min(limit, 5000)}`;
  return sql(query, params);
}

export async function deleteFilesForAdmin(ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const rows = await sql`
    DELETE FROM stored_files
    WHERE id = ANY(${ids})
    RETURNING id
  `;
  return rows.length;
}
