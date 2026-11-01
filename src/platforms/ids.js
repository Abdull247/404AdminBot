export const WHATSAPP = 'whatsapp';
export const TELEGRAM = 'telegram';

export function telegramJid(chatId) {
  return `tg:${String(chatId || '').trim()}`;
}

export function telegramUserJid(userId) {
  return `tguser:${String(userId || '').trim()}`;
}

export function parseTelegramChatId(jid) {
  const value = String(jid || '').trim();
  if (value.startsWith('tg:')) return value.slice(3);
  if (/^-?\d+$/.test(value)) return value;
  return '';
}

export function isTelegramJid(jid) {
  return String(jid || '').startsWith('tg:');
}

export function isWhatsAppJid(jid) {
  const value = String(jid || '');
  return value.includes('@') && !isTelegramJid(value);
}

export function platformOfJid(jid) {
  if (isTelegramJid(jid)) return TELEGRAM;
  if (isWhatsAppJid(jid)) return WHATSAPP;
  return '';
}

export function otherPlatform(platform) {
  return platform === TELEGRAM ? WHATSAPP : TELEGRAM;
}

export function displayPlatform(platform) {
  if (platform === TELEGRAM) return 'Telegram';
  if (platform === WHATSAPP) return 'WhatsApp';
  return platform || 'unknown';
}
