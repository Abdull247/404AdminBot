import { telegramConfig } from '../config/telegram.js';
import { env } from '../config/env.js';
import { isTelegramGroup } from './ids.js';

function ownerIds() {
  return [...new Set([
    ...(telegramConfig.ownerIds || []),
    ...env.TELEGRAM_OWNER_IDS,
  ].map((id) => String(id || '').trim()).filter(Boolean))];
}

export function isTelegramOwner(message) {
  const chat = message?.chat || message?.telegram?.chat;
  if (isTelegramGroup(chat)) return false;
  const userId = String(message?.from?.id || message?.telegram?.from?.id || '').trim();
  const allowed = ownerIds();
  if (!allowed.length) return false;
  return allowed.includes(userId);
}
