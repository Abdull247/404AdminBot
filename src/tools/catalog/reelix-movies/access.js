import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { isGroupJid } from '../../../whatsapp/filters.js';
import { digits, phoneFromJid, phoneFromMessage, samePhone } from '../../../whatsapp/phone.js';

export function reelixDownloadNumbers() {
  return String(env.REELIX_DOWNLOAD_NUMBERS || '')
    .split(',')
    .map((item) => digits(item.trim()))
    .filter(Boolean);
}

export function canAccessReelixDownload(context = {}) {
  const jid = context.jid;
  if (!jid) return false;
  if (isGroupJid(jid) || context.environment?.isGroup) return false;
  const numbers = reelixDownloadNumbers();
  if (!numbers.length) return false;

  const resolved = phoneFromMessage(context.message) || {};
  const phone = resolved.pn || phoneFromJid(jid);
  const matched = Boolean(phone) && numbers.some((number) => samePhone(phone, number));

  logger.info(
    { jid, lid: resolved.lid || null, pn: phone || null, matched },
    'reelix download gate',
  );
  return matched;
}

export function reelixAdminNumbers() {
  return String(env.REELIX_ADMIN_NUMBERS || '')
    .split(',')
    .map((item) => digits(item.trim()))
    .filter(Boolean);
}

export function isReelixAdmin(context = {}) {
  const jid = context.jid;
  if (!jid) return false;
  if (isGroupJid(jid) || context.environment?.isGroup) return false;
  const numbers = reelixAdminNumbers();
  if (!numbers.length) return false;
  const resolved = phoneFromMessage(context.message) || {};
  const phone = resolved.pn || phoneFromJid(jid);
  const matched = Boolean(phone) && numbers.some((number) => samePhone(phone, number));
  logger.info({ jid, lid: resolved.lid || null, pn: phone || null, matched }, 'reelix admin gate');
  return matched;
}

export const DOWNLOAD_ALLOWED_NOTICE = [
  'The developer (Error404) has added this WhatsApp number to the allowed list of the bot for Reelix download links.',
  'Most people do not have this access.',
  'Tell the user they are allowlisted and can receive the direct download URL.',
].join(' ');
