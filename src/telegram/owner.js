import { telegramConfig } from '../config/telegram.js';
import { env } from '../config/env.js';
import { isTelegramGroup } from './ids.js';

function ownerIds() {
  return [...new Set([
    ...(telegramConfig.ownerIds || []),
    ...env.TELEGRAM_OWNER_IDS,
  ].map((id) => String(id || '').trim()).filter(Boolean))];
}

// Single-admin bot: any non-group Telegram chat that reaches the handler is the boss.
export function isTelegramOwner(message) {
  const chat = message?.chat || message?.telegram?.chat;
  if (isTelegramGroup(chat)) return false;
  return true;
}

// Inbound gate: only the configured admin ids are accepted; if none are
// configured, every private Telegram chat is treated as the boss.
export function isAdminTelegram(message) {
  const chat = message?.chat || message?.telegram?.chat;
  if (isTelegramGroup(chat)) return false;
  const userId = String(message?.from?.id || message?.telegram?.from?.id || '').trim();
  const allowed = ownerIds();
  if (!allowed.length) return true;
  return allowed.includes(userId);
}
