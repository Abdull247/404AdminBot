export {
  WHATSAPP,
  TELEGRAM,
  telegramJid,
  telegramUserJid,
  parseTelegramChatId,
  isTelegramJid,
  isWhatsAppJid,
  platformOfJid,
  otherPlatform,
  displayPlatform,
} from './ids.js';

export {
  createLinkOffer,
  claimLinkCode,
  resolveLinkedSession,
  memoryJidFor,
  touchSessionUse,
  unlinkCurrent,
  linkStatus,
  linkedEnvironmentNotes,
  formatCodeForCommand,
} from './link.js';
