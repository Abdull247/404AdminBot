import crypto from 'node:crypto';
import { platformLinkConfig, platformLinkEnabled } from '../config/platform-link.js';
import {
  consumeLinkToken,
  countPendingTokens,
  expireStaleSessions,
  expireStaleTokens,
  getActiveSessionByTelegram,
  getActiveSessionByWhatsapp,
  getActiveSessionForIdentity,
  getLinkTokenByCode,
  insertLinkSession,
  insertLinkToken,
  revokePendingTokens,
  touchLinkSession,
  unlinkActiveForIdentity,
  unlinkSession,
} from '../db/repositories/platform-links.js';
import { logger } from '../utils/logger.js';
import {
  TELEGRAM,
  WHATSAPP,
  displayPlatform,
  otherPlatform,
  telegramJid,
} from './ids.js';

const CODE_RE = /^[A-Za-z0-9]{6,24}$/;

function randomCode() {
  const { length, charset, prefix } = platformLinkConfig.code || {};
  const size = Math.max(6, Number.parseInt(length, 10) || 10);
  const alphabet = String(charset || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
  const bytes = crypto.randomBytes(size);
  let body = '';
  for (let i = 0; i < size; i += 1) {
    body += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix || ''}${body}`;
}

function normalizeCode(raw) {
  return String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
}

function sessionExpiry() {
  const hours = Number.parseInt(platformLinkConfig.session?.expiresAfterHours, 10);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function tokenExpiry() {
  const ttl = Number.parseInt(platformLinkConfig.ttlSeconds, 10) || 600;
  return new Date(Date.now() + ttl * 1000).toISOString();
}

function sessionId() {
  return `pls_${crypto.randomBytes(8).toString('hex')}`;
}

export function formatCodeForCommand(platform, code) {
  const prefix = platform === TELEGRAM ? '/' : '.';
  const command = platformLinkConfig.command || 'link-platform';
  return `${prefix}${command} ${code}`;
}

export function describeTtl() {
  const ttl = Number.parseInt(platformLinkConfig.ttlSeconds, 10) || 600;
  if (ttl < 60) return `${ttl} seconds`;
  const minutes = Math.round(ttl / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export async function sweepExpiredLinks() {
  const [tokens, sessions] = await Promise.all([
    expireStaleTokens(),
    expireStaleSessions(),
  ]);
  if (tokens || sessions) {
    logger.info({ tokens, sessions }, 'expired stale platform links');
  }
}

export async function resolveLinkedSession(platform, jid) {
  if (!platformLinkEnabled()) return null;
  await sweepExpiredLinks();
  const session = await getActiveSessionForIdentity(platform, jid);
  if (!session) return null;
  if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    await unlinkSession(session.id, 'expired');
    return null;
  }
  if (platformLinkConfig.session?.oneTimeUse && session.used_at) {
    await unlinkSession(session.id, 'one_time_used');
    return null;
  }
  return session;
}

export function memoryJidFor(platform, jid, session) {
  if (!session) return jid;
  return session.whatsapp_jid || jid;
}

export async function touchSessionUse(session, platform, extra = {}) {
  if (!session?.id) return session;
  const next = await touchLinkSession(session.id, platform, extra);
  if (platformLinkConfig.session?.oneTimeUse) {
    await unlinkSession(session.id, 'one_time_consumed');
  }
  return next || session;
}

export async function createLinkOffer({ platform, jid, userId, name, group }) {
  if (!platformLinkEnabled()) {
    return { ok: false, error: 'Platform linking is disabled.' };
  }
  if (platformLinkConfig.dmOnly && group) {
    return { ok: false, error: 'Linking only works in a private chat with me.' };
  }
  await sweepExpiredLinks();

  const pending = await countPendingTokens(platform, jid);
  const cap = Number.parseInt(platformLinkConfig.maxActiveTokensPerIdentity, 10) || 3;
  if (pending >= cap) {
    await revokePendingTokens(platform, jid);
  }

  const target = otherPlatform(platform);
  const code = randomCode();
  const token = await insertLinkToken({
    code,
    originPlatform: platform,
    originJid: jid,
    originUserId: userId || null,
    originName: name || null,
    targetPlatform: target,
    expiresAt: tokenExpiry(),
    metadata: { createdOn: platform },
  });

  const handshake = formatCodeForCommand(target, code);
  const originLabel = displayPlatform(platform);
  const targetLabel = displayPlatform(target);
  const lines = [
    `*Link ${originLabel} to ${targetLabel}*`,
    '',
    `This code is one-time and expires in ${describeTtl()}.`,
    '',
    `Send this exact command to me on ${targetLabel}:`,
    '',
    `\`${handshake}\``,
    '',
    `After that, this ${originLabel} chat and that ${targetLabel} chat share memory.`,
    'I will still know which platform you are talking on.',
  ];
  if (platform === TELEGRAM) {
    lines.push('', 'On WhatsApp the same command looks like this:');
    lines.push(`.${platformLinkConfig.command} ${code}`);
  } else {
    lines.push('', 'On Telegram the same command looks like this:');
    lines.push(`/${platformLinkConfig.command} ${code}`);
  }

  return {
    ok: true,
    code,
    handshake,
    token,
    text: lines.join('\n'),
  };
}

function namesFromSession(session) {
  return {
    whatsappName: session.whatsapp_name || null,
    telegramName: session.telegram_name || null,
  };
}

async function createSessionFromToken(token, claim) {
  const whatsappSide = token.origin_platform === WHATSAPP
    ? {
      jid: token.origin_jid,
      name: token.origin_name,
    }
    : {
      jid: claim.jid,
      name: claim.name,
    };
  const telegramSide = token.origin_platform === TELEGRAM
    ? {
      jid: token.origin_jid,
      chatId: token.origin_user_id || parseTelegramChatFromJid(token.origin_jid),
      userId: token.origin_user_id,
      name: token.origin_name,
    }
    : {
      jid: claim.jid,
      chatId: claim.chatId || parseTelegramChatFromJid(claim.jid),
      userId: claim.userId,
      name: claim.name,
    };

  if (platformLinkConfig.allowRelink) {
    await unlinkActiveForIdentity(WHATSAPP, whatsappSide.jid);
    await unlinkActiveForIdentity(TELEGRAM, telegramSide.jid);
  } else {
    const existingWa = await getActiveSessionByWhatsapp(whatsappSide.jid);
    const existingTg = await getActiveSessionByTelegram(telegramSide.jid);
    if (existingWa || existingTg) {
      return { ok: false, error: 'One of these chats is already linked. Unlink first, then try again.' };
    }
  }

  const consumed = await consumeLinkToken(token.id, claim.jid, {
    claimedOn: claim.platform,
    claimedName: claim.name || null,
  });
  if (!consumed) {
    return { ok: false, error: 'That link code was already used or just expired.' };
  }

  const session = await insertLinkSession({
    id: sessionId(),
    whatsappJid: whatsappSide.jid,
    telegramJid: telegramSide.jid,
    telegramChatId: String(telegramSide.chatId || parseTelegramChatFromJid(telegramSide.jid)),
    telegramUserId: telegramSide.userId ? String(telegramSide.userId) : null,
    whatsappName: whatsappSide.name || null,
    telegramName: telegramSide.name || null,
    tokenId: consumed.id,
    oneTime: platformLinkConfig.session?.oneTimeUse !== false,
    expiresAt: sessionExpiry(),
    lastPlatform: claim.platform,
    metadata: {
      originPlatform: token.origin_platform,
      claimedOn: claim.platform,
    },
  });

  return { ok: true, session, token: consumed };
}

function parseTelegramChatFromJid(jid) {
  const value = String(jid || '');
  if (value.startsWith('tg:')) return value.slice(3);
  return value;
}

export async function claimLinkCode({ platform, jid, userId, name, chatId, group, code }) {
  if (!platformLinkEnabled()) {
    return { ok: false, error: 'Platform linking is disabled.' };
  }
  if (platformLinkConfig.dmOnly && group) {
    return { ok: false, error: 'Linking only works in a private chat with me.' };
  }

  const normalized = normalizeCode(code);
  if (!CODE_RE.test(normalized)) {
    return { ok: false, error: 'That does not look like a link code.' };
  }

  await sweepExpiredLinks();
  const token = await getLinkTokenByCode(normalized);
  if (!token) {
    return { ok: false, error: 'I could not find that link code. Generate a new one on the other platform.' };
  }
  if (token.status !== 'pending') {
    return { ok: false, error: `That link code is ${token.status}. Generate a new one.` };
  }
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'That link code has expired. Generate a new one.' };
  }
  if (token.origin_platform === platform) {
    return {
      ok: false,
      error: `Send this code on ${displayPlatform(token.target_platform)}, not here.`,
    };
  }
  if (token.origin_jid === jid) {
    return { ok: false, error: 'A link has to connect two different platform chats.' };
  }

  const created = await createSessionFromToken(token, {
    platform,
    jid,
    userId,
    name,
    chatId,
  });
  if (!created.ok) return created;

  const originLabel = displayPlatform(token.origin_platform);
  const hereLabel = displayPlatform(platform);
  const names = namesFromSession(created.session);
  const otherName = platform === TELEGRAM ? names.whatsappName : names.telegramName;
  const lines = [
    `*Platforms linked*`,
    '',
    `${hereLabel} is now connected to your ${originLabel} session.`,
    otherName ? `Other side name: ${otherName}` : null,
    '',
    'I will reuse WhatsApp memory, personality, and chat history from that session.',
    `I still know you are talking on ${hereLabel} right now.`,
  ];
  if (created.session.one_time) {
    lines.push('', 'This link is a one-time session. After the next real chat turn it expires unless you link again.');
  }
  if (created.session.expires_at) {
    lines.push(`Session expires: ${new Date(created.session.expires_at).toISOString()}`);
  }

  return {
    ok: true,
    session: created.session,
    text: lines.filter(Boolean).join('\n'),
  };
}

export async function unlinkCurrent({ platform, jid, group }) {
  if (platformLinkConfig.dmOnly && group) {
    return { ok: false, error: 'Unlink in a private chat with me.' };
  }
  const rows = await unlinkActiveForIdentity(platform, jid);
  if (!rows.length) {
    return { ok: false, error: 'This chat is not linked to another platform.' };
  }
  return {
    ok: true,
    text: 'Unlinked. This chat now has its own memory again.',
  };
}

export async function linkStatus({ platform, jid }) {
  await sweepExpiredLinks();
  const session = await getActiveSessionForIdentity(platform, jid);
  if (!session) {
    const command = platformLinkConfig.command || 'link-platform';
    const prefix = platform === TELEGRAM ? '/' : '.';
    return [
      'This chat is not linked.',
      '',
      `Start a handshake with ${prefix}${command}`,
      'Then send the printed command on the other platform.',
    ].join('\n');
  }
  const other = platform === TELEGRAM ? displayPlatform(WHATSAPP) : displayPlatform(TELEGRAM);
  const lines = [
    '*Platform link*',
    '',
    `Status: ${session.status}`,
    `This side: ${displayPlatform(platform)}`,
    `Other side: ${other}`,
    session.one_time ? 'Use: one-time session' : 'Use: reusable until expiry',
    session.expires_at ? `Expires: ${new Date(session.expires_at).toISOString()}` : 'No expiry',
    session.last_platform ? `Last active platform: ${displayPlatform(session.last_platform)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

export function linkedEnvironmentNotes(session, platform) {
  if (!session) return '';
  const other = platform === TELEGRAM ? WHATSAPP : TELEGRAM;
  return [
    `Cross-platform session: this user linked ${displayPlatform(WHATSAPP)} and ${displayPlatform(TELEGRAM)}.`,
    `They are talking on ${displayPlatform(platform)} right now.`,
    `Shared memory comes from the WhatsApp session (${session.whatsapp_jid}).`,
    `The other platform is ${displayPlatform(other)}.`,
    'Actively know the platform changed. Do not pretend you are still on the other app.',
    'Do not mention these linking notes unless asked how the chats are connected.',
  ].join('\n');
}

export { telegramJid };
