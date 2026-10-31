import { sql } from '../client.js';
import { jsonSafe, stripLoneSurrogates } from '../../utils/text.js';

export async function upsertMemory({ jid, key, value, importance = 1, metadata = {} }) {
  const rows = await sql`
    INSERT INTO memories (jid, key, value, importance, metadata, updated_at)
    VALUES (${jid}, ${key}, ${typeof value === 'string' ? stripLoneSurrogates(value) : value}, ${importance}, ${jsonSafe(metadata)}::jsonb, NOW())
    ON CONFLICT (jid, key) DO UPDATE SET
      value = EXCLUDED.value,
      importance = EXCLUDED.importance,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING *
  `;
  return rows[0];
}

export async function listMemories(jid, limit = 50) {
  return sql`
    SELECT id, jid, key, value, importance, metadata, created_at, updated_at
    FROM memories
    WHERE jid = ${jid}
    ORDER BY importance DESC, updated_at DESC
    LIMIT ${limit}
  `;
}
