import { upsertChat } from '../db/repositories/chats.js';
import { addMessage } from '../db/repositories/conversations.js';
import { logger } from '../utils/logger.js';
import { stripLoneSurrogates, truncateText } from '../utils/text.js';
import { extractText, isGroupJid, unwrapMessageContent } from './filters.js';
import { loadGroupDetails } from './group.js';
import { getCurrentSocket } from './socket.js';

const MAX_PREVIEW = 240;

function preview(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return truncateText(value, MAX_PREVIEW);
}

function participantJid(message, jid) {
  return message.key?.participant
    || message.participant
    || (isGroupJid(jid) ? null : jid);
}

export async function resolveChatName(sock, jid, fallbackName = null) {
  if (fallbackName) return fallbackName;
  const client = sock || getCurrentSocket();
  if (!client) return null;

  try {
    if (isGroupJid(jid)) {
      const meta = await loadGroupDetails(client, jid);
      return meta?.name || null;
    }
  } catch (error) {
    logger.debug({ err: error, jid }, 'failed to load group metadata');
  }

  try {
    if (typeof client.onWhatsApp === 'function' && !isGroupJid(jid)) {
      const info = await client.onWhatsApp(jid);
      const first = Array.isArray(info) ? info[0] : info;
      if (first?.notify) return first.notify;
    }
  } catch {
    // ignore
  }

  return null;
}

export async function logIncomingMessage(sock, message, {
  text,
  pushName,
  replied = false,
  mentioned = false,
  replyToBot = false,
} = {}) {
  const jid = message?.key?.remoteJid;
  if (!jid) return;

  const body = stripLoneSurrogates(
    text || extractText(message) || (unwrapMessageContent(message).imageMessage ? '[image]' : ''),
  );
  if (!body) return;

  const safePushName = pushName ? stripLoneSurrogates(String(pushName)) : null;
  const type = isGroupJid(jid) ? 'group' : 'dm';
  const sender = participantJid(message, jid);
  const groupDetails = type === 'group' ? await loadGroupDetails(sock, jid) : null;
  const name = type === 'dm'
    ? await resolveChatName(sock, jid, safePushName)
    : groupDetails?.name || await resolveChatName(sock, jid, null);

  try {
    await upsertChat({
      jid,
      name,
      type,
      lastMessage: preview(body),
      lastSender: safePushName || sender,
      metadata: {
        lastParticipant: sender,
        lastPushName: safePushName,
        mentioned,
        replyToBot,
        group: groupDetails || undefined,
      },
    });
  } catch (error) {
    logger.warn({ err: error, jid }, 'failed to upsert chat listing');
  }

  const fromMe = Boolean(message.key?.fromMe);

  try {
    await addMessage({
      jid,
      role: 'user',
      content: body,
      metadata: {
        pushName: safePushName || (fromMe ? 'You' : null),
        participant: sender,
        fromMe,
        messageId: message.key?.id || null,
        replied,
        mentioned,
        replyToBot,
        source: 'whatsapp',
      },
    });
  } catch (error) {
    logger.warn({ err: error, jid }, 'failed to log incoming chat message');
  }
}
