import { upsertChat } from '../db/repositories/chats.js';
import { addMessage } from '../db/repositories/conversations.js';
import { logger } from '../utils/logger.js';
import { stripLoneSurrogates, truncateText } from '../utils/text.js';
import { extractTelegramText } from './filters.js';
import { displayName, isTelegramGroup, telegramJid } from './ids.js';

const MAX_PREVIEW = 240;

function preview(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return truncateText(value, MAX_PREVIEW);
}

export async function logTelegramMessage(message, {
  jid,
  text,
  pushName,
  replied = false,
  mentioned = false,
  replyToBot = false,
} = {}) {
  const chatId = message?.chat?.id;
  const resolvedJid = jid || telegramJid(chatId);
  if (!resolvedJid) return;

  const body = stripLoneSurrogates(
    text || extractTelegramText(message) || (message?.photo ? '[image]' : ''),
  );
  if (!body) return;

  const group = isTelegramGroup(message?.chat);
  const safePushName = pushName ? stripLoneSurrogates(String(pushName)) : displayName(message?.from);
  const type = group ? 'group' : 'dm';
  const sender = group ? `tguser:${message?.from?.id}` : resolvedJid;

  try {
    await upsertChat({
      jid: resolvedJid,
      name: group ? (message?.chat?.title || null) : safePushName,
      type,
      lastMessage: preview(body),
      lastSender: safePushName || sender,
      metadata: {
        platform: 'telegram',
        lastParticipant: sender,
        lastPushName: safePushName,
        mentioned,
        replyToBot,
        telegramChatId: String(chatId),
      },
    });
  } catch (error) {
    logger.warn({ err: error, jid: resolvedJid }, 'failed to upsert telegram chat listing');
  }

  try {
    await addMessage({
      jid: resolvedJid,
      role: 'user',
      content: body,
      metadata: {
        pushName: safePushName,
        participant: sender,
        fromMe: false,
        messageId: String(message?.message_id || ''),
        replied,
        mentioned,
        replyToBot,
        source: 'telegram',
      },
    });
  } catch (error) {
    logger.warn({ err: error, jid: resolvedJid }, 'failed to log telegram chat message');
  }
}
