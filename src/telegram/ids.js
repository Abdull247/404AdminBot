import { telegramJid, telegramUserJid, parseTelegramChatId } from '../platforms/ids.js';

export { telegramJid, telegramUserJid, parseTelegramChatId };

export function displayName(user = {}) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    || user.username
    || null;
}

export function isTelegramGroup(chat) {
  const type = String(chat?.type || '');
  return type === 'group' || type === 'supergroup';
}

export function quotedMessageId(message) {
  return message?.reply_to_message?.message_id || null;
}
