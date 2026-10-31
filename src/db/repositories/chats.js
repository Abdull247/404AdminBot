import { sql } from '../client.js';
import { jsonSafe, stripLoneSurrogates } from '../../utils/text.js';

export async function upsertChat({
  jid,
  name = null,
  type = 'unknown',
  lastMessage = null,
  lastSender = null,
  metadata = {},
}) {
  const rows = await sql`
    INSERT INTO chats (
      jid, name, type, last_message, last_sender, last_message_at, message_count, metadata, updated_at
    )
    VALUES (
      ${jid},
      ${name ? stripLoneSurrogates(name) : null},
      ${type},
      ${lastMessage ? stripLoneSurrogates(lastMessage) : null},
      ${lastSender ? stripLoneSurrogates(String(lastSender)) : null},
      NOW(),
      1,
      ${jsonSafe(metadata)}::jsonb,
      NOW()
    )
    ON CONFLICT (jid) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, chats.name),
      type = EXCLUDED.type,
      last_message = COALESCE(EXCLUDED.last_message, chats.last_message),
      last_sender = COALESCE(EXCLUDED.last_sender, chats.last_sender),
      last_message_at = NOW(),
      message_count = chats.message_count + 1,
      metadata = chats.metadata || EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function getChat(jid) {
  const rows = await sql`SELECT * FROM chats WHERE jid = ${jid} LIMIT 1`;
  return rows[0] ?? null;
}

export async function listChats({ limit = 30 } = {}) {
  return sql`
    SELECT jid, name, type, last_message, last_sender, last_message_at, message_count, created_at, updated_at
    FROM chats
    ORDER BY last_message_at DESC NULLS LAST, updated_at DESC
    LIMIT ${limit}
  `;
}

export async function findChats(query, limit = 10) {
  const needle = String(query || '').trim();
  if (!needle) return [];
  const like = `%${needle}%`;
  return sql`
    SELECT jid, name, type, last_message, last_sender, last_message_at, message_count, created_at, updated_at
    FROM chats
    WHERE jid = ${needle}
      OR COALESCE(name, '') ILIKE ${like}
      OR jid ILIKE ${like}
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT ${limit}
  `;
}

export async function countChats() {
  const rows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE type = 'dm')::int AS dms,
      COUNT(*) FILTER (WHERE type = 'group')::int AS groups
    FROM chats
  `;
  return rows[0] || { total: 0, dms: 0, groups: 0 };
}
