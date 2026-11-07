import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { isGroupJid, isNewsletterJid } from './filters.js';
import { listOwnerNumbers } from './owner.js';
import { digits, phoneFromJid, phoneFromMessage, samePhone } from './phone.js';

let resolvedChannelJid = '';

export function restrictAccessEnabled() {
  return Boolean(env.REELIX_RESTRICT_ACCESS);
}

export function reelixGroupEnabled() {
  return Boolean(env.REELIX_GROUP_ENABLED);
}

export function reelixChannelEnabled() {
  return Boolean(env.REELIX_CHANNEL_ENABLED);
}

export function normalizeGroupJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.endsWith('@g.us')) return raw;
  if (raw.includes('@')) return '';
  const id = raw.replace(/\D/g, '');
  return id ? `${id}@g.us` : '';
}

export function normalizeChannelJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.endsWith('@newsletter')) return raw;
  if (raw.includes('@') || raw.includes('/')) return '';
  const id = raw.replace(/\D/g, '');
  return id ? `${id}@newsletter` : '';
}

export function reelixChannelInviteCode(value = env.REELIX_CHANNEL_INVITE) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:whatsapp\.com\/channel\/)?([A-Za-z0-9]{10,})/i);
  if (match) return match[1];
  return /^[A-Za-z0-9]+$/.test(raw) ? raw : '';
}

export function reelixGroupJid() {
  return normalizeGroupJid(env.REELIX_GROUP_JID);
}

export function reelixChannelJid() {
  return normalizeChannelJid(env.REELIX_CHANNEL_JID) || resolvedChannelJid;
}

export function isReelixGroupJid(jid) {
  const target = reelixGroupJid();
  if (!target || !jid) return false;
  return normalizeGroupJid(jid) === target;
}

export async function resolveReelixChannelJid(sock) {
  const fromEnv = normalizeChannelJid(env.REELIX_CHANNEL_JID);
  if (fromEnv) {
    resolvedChannelJid = fromEnv;
    return fromEnv;
  }
  if (resolvedChannelJid) return resolvedChannelJid;

  const invite = reelixChannelInviteCode();
  if (!invite) return '';
  if (typeof sock?.newsletterMetadata !== 'function') {
    logger.warn('cannot resolve Reelix channel jid: newsletterMetadata is missing');
    return '';
  }

  try {
    const meta = await sock.newsletterMetadata('invite', invite);
    const id = String(meta?.id || meta?.jid || '').trim();
    if (isNewsletterJid(id)) {
      resolvedChannelJid = id;
      logger.info({ channelJid: id, invite }, 'resolved Reelix channel jid from invite');
      return id;
    }
    logger.warn({ invite, meta }, 'Reelix channel invite did not return a newsletter jid');
  } catch (error) {
    logger.warn({ err: error, invite }, 'failed to resolve Reelix channel jid from invite');
  }
  return '';
}

export async function reelixSendDestinations(sock, explicitJid = '') {
  const destinations = [];
  const seen = new Set();

  function add(type, jid) {
    const value = String(jid || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    destinations.push({ type, jid: value });
  }

  const extra = String(explicitJid || '').trim();
  if (extra) {
    const asChannel = normalizeChannelJid(extra) || (isNewsletterJid(extra) ? extra : '');
    const asGroup = normalizeGroupJid(extra) || (isGroupJid(extra) ? extra : '');
    if (asChannel) add('channel', asChannel);
    else if (asGroup) add('group', asGroup);
    else add('chat', extra);
    return destinations;
  }

  if (reelixGroupEnabled()) add('group', reelixGroupJid());
  if (reelixChannelEnabled()) add('channel', await resolveReelixChannelJid(sock));
  return destinations;
}

function adminNumbers() {
  return String(env.REELIX_ADMIN_NUMBERS || '')
    .split(',')
    .map((item) => digits(item.trim()))
    .filter(Boolean);
}

function lockdownAllowlist() {
  return [...new Set([
    ...listOwnerNumbers(),
    ...adminNumbers(),
  ].map(digits).filter(Boolean))];
}

export function isLockdownAllowed({ jid, message = null } = {}) {
  if (!restrictAccessEnabled()) return true;
  if (isReelixGroupJid(jid)) return true;
  if (isGroupJid(jid)) return false;

  const numbers = lockdownAllowlist();
  if (!numbers.length) return false;

  const resolved = phoneFromMessage(message || {}) || {};
  const phone = resolved.pn || phoneFromJid(jid);
  if (!phone) return false;
  return numbers.some((number) => samePhone(phone, number));
}
