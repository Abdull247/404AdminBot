import { env } from '../config/env.js';
import { appConfig } from '../config/load-config.js';
import { isGroupJid } from './filters.js';
import { digits, phoneFromJid, samePhone } from './phone.js';

// Numbers that are explicitly configured as the boss. Deliberately does NOT
// fall back to the linked WhatsApp number, so an unconfigured bot treats every
// direct message as the boss instead of locking everyone out.
function explicitOwnerNumbers() {
  const fromConfig = Array.isArray(appConfig.bot.ownerNumbers) ? appConfig.bot.ownerNumbers : [];
  const fromEnv = env.OWNER_NUMBERS
    ? env.OWNER_NUMBERS.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  return [...new Set([...fromConfig, ...fromEnv].map(digits).filter(Boolean))];
}

export function listOwnerNumbers() {
  return explicitOwnerNumbers();
}

export { phoneFromJid, samePhone } from './phone.js';

// Single-admin bot: any non-group chat that reaches the handlers is the boss.
export function isOwnerJid(jid) {
  return Boolean(jid) && !isGroupJid(jid);
}

// Inbound gate for the single-admin WhatsApp bot. Groups are never handled.
// If one or more admin numbers are configured, only those numbers are
// accepted; otherwise every direct message is treated as the boss.
export function isAdminWhatsAppJid(jid, sock = null) {
  if (!jid || isGroupJid(jid)) return false;
  const phone = phoneFromJid(jid);
  if (!phone) return false;
  const numbers = explicitOwnerNumbers();
  if (!numbers.length) return true;
  const connected = sock?.user?.id ? phoneFromJid(sock.user.id) : '';
  const allowed = connected ? [...numbers, connected] : numbers;
  return allowed.some((number) => samePhone(phone, number));
}
