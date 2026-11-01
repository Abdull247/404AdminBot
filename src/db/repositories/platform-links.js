import { sql } from '../client.js';
import { jsonSafe } from '../../utils/text.js';

export async function insertLinkToken(token) {
  const rows = await sql`
    INSERT INTO platform_link_tokens (
      code, origin_platform, origin_jid, origin_user_id, origin_name,
      target_platform, status, expires_at, metadata
    )
    VALUES (
      ${token.code},
      ${token.originPlatform},
      ${token.originJid},
      ${token.originUserId || null},
      ${token.originName || null},
      ${token.targetPlatform},
      ${token.status || 'pending'},
      ${token.expiresAt},
      ${jsonSafe(token.metadata || {})}::jsonb
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function getLinkTokenByCode(code) {
  const rows = await sql`
    SELECT * FROM platform_link_tokens
    WHERE code = ${code}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listPendingTokens(originPlatform, originJid) {
  return sql`
    SELECT * FROM platform_link_tokens
    WHERE origin_platform = ${originPlatform}
      AND origin_jid = ${originJid}
      AND status = 'pending'
    ORDER BY created_at DESC
  `;
}

export async function countPendingTokens(originPlatform, originJid) {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM platform_link_tokens
    WHERE origin_platform = ${originPlatform}
      AND origin_jid = ${originJid}
      AND status = 'pending'
      AND expires_at > NOW()
  `;
  return rows[0]?.count || 0;
}

export async function expireStaleTokens() {
  const rows = await sql`
    UPDATE platform_link_tokens
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at <= NOW()
    RETURNING id
  `;
  return rows.length;
}

export async function revokePendingTokens(originPlatform, originJid) {
  const rows = await sql`
    UPDATE platform_link_tokens
    SET status = 'revoked'
    WHERE origin_platform = ${originPlatform}
      AND origin_jid = ${originJid}
      AND status = 'pending'
    RETURNING *
  `;
  return rows;
}

export async function consumeLinkToken(id, consumedJid, metadata = {}) {
  const rows = await sql`
    UPDATE platform_link_tokens
    SET
      status = 'consumed',
      consumed_at = NOW(),
      consumed_jid = ${consumedJid},
      metadata = metadata || ${jsonSafe(metadata)}::jsonb
    WHERE id = ${id}
      AND status = 'pending'
      AND expires_at > NOW()
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function insertLinkSession(session) {
  const rows = await sql`
    INSERT INTO platform_link_sessions (
      id, whatsapp_jid, telegram_jid, telegram_chat_id, telegram_user_id,
      whatsapp_name, telegram_name, token_id, status, one_time,
      expires_at, last_platform, last_seen_at, metadata
    )
    VALUES (
      ${session.id},
      ${session.whatsappJid},
      ${session.telegramJid},
      ${session.telegramChatId},
      ${session.telegramUserId || null},
      ${session.whatsappName || null},
      ${session.telegramName || null},
      ${session.tokenId || null},
      ${session.status || 'active'},
      ${session.oneTime !== false},
      ${session.expiresAt || null},
      ${session.lastPlatform || null},
      NOW(),
      ${jsonSafe(session.metadata || {})}::jsonb
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function getActiveSessionByWhatsapp(jid) {
  const rows = await sql`
    SELECT * FROM platform_link_sessions
    WHERE whatsapp_jid = ${jid}
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getActiveSessionByTelegram(jid) {
  const rows = await sql`
    SELECT * FROM platform_link_sessions
    WHERE telegram_jid = ${jid}
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getActiveSessionForIdentity(platform, jid) {
  if (platform === 'telegram') return getActiveSessionByTelegram(jid);
  return getActiveSessionByWhatsapp(jid);
}

export async function expireStaleSessions() {
  const rows = await sql`
    UPDATE platform_link_sessions
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= NOW()
    RETURNING id
  `;
  return rows.length;
}

export async function unlinkSession(id, reason = 'unlinked') {
  const rows = await sql`
    UPDATE platform_link_sessions
    SET
      status = 'unlinked',
      updated_at = NOW(),
      metadata = metadata || ${jsonSafe({ unlinkedReason: reason, unlinkedAt: new Date().toISOString() })}::jsonb
    WHERE id = ${id}
      AND status = 'active'
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function unlinkActiveForIdentity(platform, jid) {
  const column = platform === 'telegram' ? 'telegram_jid' : 'whatsapp_jid';
  const rows = column === 'telegram_jid'
    ? await sql`
        UPDATE platform_link_sessions
        SET status = 'unlinked', updated_at = NOW()
        WHERE telegram_jid = ${jid} AND status = 'active'
        RETURNING *
      `
    : await sql`
        UPDATE platform_link_sessions
        SET status = 'unlinked', updated_at = NOW()
        WHERE whatsapp_jid = ${jid} AND status = 'active'
        RETURNING *
      `;
  return rows;
}

export async function touchLinkSession(id, platform, extra = {}) {
  const rows = await sql`
    UPDATE platform_link_sessions
    SET
      last_platform = ${platform},
      last_seen_at = NOW(),
      used_at = COALESCE(used_at, NOW()),
      metadata = metadata || ${jsonSafe(extra)}::jsonb,
      updated_at = NOW()
    WHERE id = ${id}
      AND status = 'active'
    RETURNING *
  `;
  return rows[0] ?? null;
}
