import { env } from '../../../config/env.js';
import { isGroupJid } from '../../../whatsapp/filters.js';
import { phoneFromJid } from '../../../whatsapp/owner.js';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function samePhone(left, right) {
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

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
  const phone = phoneFromJid(jid);
  if (!phone) return false;
  return numbers.some((number) => samePhone(phone, number));
}

export const DOWNLOAD_ALLOWED_NOTICE = [
  'The developer (Error404) has added this WhatsApp number to the allowed list of the bot for Reelix download links.',
  'Most people do not have this access.',
  'Tell the user they are allowlisted and can receive the direct download URL.',
].join(' ');
