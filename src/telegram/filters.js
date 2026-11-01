import { telegramConfig } from '../config/telegram.js';
import { appConfig } from '../config/load-config.js';
import { displayName, isTelegramGroup } from './ids.js';

export function extractTelegramText(message) {
  return String(
    message?.text
    || message?.caption
    || '',
  ).trim();
}

export function botMentioned(message, bot) {
  const text = extractTelegramText(message);
  const username = String(bot?.username || telegramConfig.botUsername || '').replace(/^@/, '');
  if (username && new RegExp(`@${username}\\b`, 'i').test(text)) return true;
  const entities = [...(message?.entities || []), ...(message?.caption_entities || [])];
  return entities.some((entity) => {
    if (entity.type === 'mention' && username) {
      const token = text.slice(entity.offset, entity.offset + entity.length);
      return token.replace(/^@/, '').toLowerCase() === username.toLowerCase();
    }
    if (entity.type === 'text_mention' && bot?.id) {
      return Number(entity.user?.id) === Number(bot.id);
    }
    return false;
  });
}

export function replyToBot(message, bot) {
  const quoted = message?.reply_to_message;
  if (!quoted) return false;
  if (quoted.from?.is_bot && Number(quoted.from?.id) === Number(bot?.id)) return true;
  const name = String(appConfig.bot.name || '').trim();
  if (name && quoted.from?.first_name === name) return true;
  return false;
}

export function shouldReplyToTelegram(message, bot) {
  const group = isTelegramGroup(message?.chat);
  const mentioned = botMentioned(message, bot);
  const quoted = replyToBot(message, bot);
  if (!group) {
    return { shouldReply: true, mentioned, replyToBot: quoted, trigger: 'message', group: false };
  }
  if (!telegramConfig.ignoreGroups) {
    return { shouldReply: true, mentioned, replyToBot: quoted, trigger: mentioned ? 'mention' : 'message', group: true };
  }
  const mentionOk = mentioned && telegramConfig.respondToMentionsInGroups !== false;
  const replyOk = quoted && telegramConfig.respondToRepliesInGroups !== false;
  return {
    shouldReply: mentionOk || replyOk,
    mentioned,
    replyToBot: quoted,
    trigger: mentioned && quoted ? 'mention_and_reply' : mentioned ? 'mention' : quoted ? 'reply' : 'message',
    group: true,
  };
}

export function wrapTelegramMessage(message, bot) {
  const chatId = message?.chat?.id;
  const from = message?.from || {};
  const group = isTelegramGroup(message?.chat);
  const text = extractTelegramText(message);
  return {
    key: {
      remoteJid: `tg:${chatId}`,
      id: String(message?.message_id || ''),
      fromMe: Boolean(from.is_bot && Number(from.id) === Number(bot?.id)),
      participant: group ? `tguser:${from.id}` : `tg:${chatId}`,
    },
    pushName: displayName(from),
    messageTimestamp: message?.date || Math.floor(Date.now() / 1000),
    telegram: message,
    telegramBot: bot,
    message: {
      conversation: text,
    },
  };
}

export function stripTelegramMention(text, bot) {
  let value = String(text || '');
  const username = String(bot?.username || telegramConfig.botUsername || '').replace(/^@/, '');
  if (username) {
    value = value.replace(new RegExp(`(?:^|\\s)@${username}\\b`, 'gi'), ' ');
  }
  return value.replace(/\s+/g, ' ').trim();
}
