import { sql } from '../client.js';
import { jsonSafe, stripLoneSurrogates } from '../../utils/text.js';

export async function addMessage({ jid, role, content, metadata = {} }) {
  const rows = await sql`
    INSERT INTO conversations (jid, role, content, metadata)
    VALUES (${jid}, ${role}, ${stripLoneSurrogates(content)}, ${jsonSafe(metadata)}::jsonb)
    RETURNING *
  `;
  return rows[0];
}

export async function getRecentMessages(jid, limit = 20) {
  const rows = await sql`
    SELECT id, jid, role, content, metadata, created_at
    FROM conversations
    WHERE jid = ${jid}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.reverse();
}

export async function searchMessages(jid, query, limit = 40) {
  const needle = String(query || '').trim();
  if (!needle) return getRecentMessages(jid, limit);
  const like = `%${needle}%`;
  const rows = await sql`
    SELECT id, jid, role, content, metadata, created_at
    FROM conversations
    WHERE jid = ${jid}
      AND content ILIKE ${like}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows.reverse();
}

export async function countMessages(jid) {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM conversations
    WHERE jid = ${jid}
  `;
  return rows[0]?.count || 0;
}
