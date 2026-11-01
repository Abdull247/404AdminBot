import { parseTelegramChatId } from './ids.js';
import { sendTelegramContent, showTelegramTyping } from './send.js';

let currentBot = null;
let connectionStatus = 'stopped';

export function setTelegramBot(bot) {
  currentBot = bot || null;
}

export function getTelegramBot() {
  return currentBot;
}

export function setTelegramStatus(status) {
  connectionStatus = status || 'unknown';
}

export function getTelegramStatus() {
  return connectionStatus;
}

export function createTelegramSock(bot, quoted = null) {
  return {
    platform: 'telegram',
    bot,
    user: {
      id: bot?.id ? `tg:${bot.id}` : null,
      name: bot?.username || bot?.first_name || null,
    },
    async sendMessage(jid, content, options = {}) {
      return sendTelegramContent(jid, content, options.quoted || quoted);
    },
    async presenceSubscribe() {},
    async sendPresenceUpdate(state, jid) {
      if (state === 'composing') await showTelegramTyping(jid);
    },
    async readMessages() {},
    async groupMetadata() {
      return {
        id: quoted?.key?.remoteJid,
        subject: quoted?.telegram?.chat?.title || null,
        desc: '',
        participants: [],
      };
    },
    telegramChatId(jid) {
      return parseTelegramChatId(jid);
    },
  };
}
