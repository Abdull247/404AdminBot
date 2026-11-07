import { env } from '../config/env.js';
import { isGroupJid } from './filters.js';
import { listOwnerNumbers } from './owner.js';
import { digits, phoneFromJid, phoneFromMessage, samePhone } from './phone.js';

export function restrictAccessEnabled() {
  return Boolean(env.REELIX_RESTRICT_ACCESS);
}

export function normalizeGroupJid(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.endsWith('@g.us')) return raw;
  const id = raw.replace(/\D/g, '');
  return id ? `${id}@g.us` : '';
}

export function reelixGroupJid() {
  return normalizeGroupJid(env.REELIX_GROUP_JID);
}

export function isReelixGroupJid(jid) {
  const target = reelixGroupJid();
  if (!target || !jid) return false;
  return normalizeGroupJid(jid) === target;
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
