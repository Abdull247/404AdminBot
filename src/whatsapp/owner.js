import { env } from '../config/env.js';
import { appConfig } from '../config/load-config.js';
import { isGroupJid } from './filters.js';
import { digits, phoneFromJid, samePhone } from './phone.js';

function ownerNumbers() {
  const fromConfig = Array.isArray(appConfig.bot.ownerNumbers) ? appConfig.bot.ownerNumbers : [];
  const fromEnv = env.OWNER_NUMBERS
    ? env.OWNER_NUMBERS.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const fallback = env.WHATSAPP_PHONE_NUMBER ? [env.WHATSAPP_PHONE_NUMBER] : [];
  return [...new Set([...fromConfig, ...fromEnv, ...fallback].map(digits).filter(Boolean))];
}

export { phoneFromJid, samePhone } from './phone.js';

export function isOwnerJid(jid, sock = null) {
  if (isGroupJid(jid)) return false;
  const phone = phoneFromJid(jid);
  if (!phone) return false;
  const numbers = ownerNumbers();
  const connected = sock?.user?.id ? phoneFromJid(sock.user.id) : '';
  const allowed = connected ? [...numbers, connected] : numbers;
  if (!allowed.length) return true;
  return allowed.some((number) => samePhone(phone, number));
}
