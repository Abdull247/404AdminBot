import { appConfig } from '../config/load-config.js';
import { telegramConfig, telegramCommandPrefix } from '../config/telegram.js';
import { generateReply } from '../ai/agent.js';
import { tryHandleCommand } from '../commands/index.js';
import { rememberUser } from '../memory/store.js';
import { logger } from '../utils/logger.js';
import { getAiRuntime } from '../config/providers.js';
import { pickGroupReaction } from '../whatsapp/react.js';
import { enqueueChatWork } from '../whatsapp/request-queue.js';
import { addMessage } from '../db/repositories/conversations.js';
import { TELEGRAM } from '../platforms/ids.js';
import {
  linkedEnvironmentNotes,
  memoryJidFor,
  resolveLinkedSession,
  touchSessionUse,
} from '../platforms/link.js';
import { extractTelegramText, shouldReplyToTelegram, stripTelegramMention, wrapTelegramMessage } from './filters.js';
import { hasTelegramAttachment, hasTelegramImage, downloadTelegramImage } from './media.js';
import { displayName, isTelegramGroup } from './ids.js';
import { logTelegramMessage } from './log-message.js';
import { createTelegramSock } from './socket.js';
import { sendTelegramArtifacts, sendTelegramText, showTelegramTyping } from './send.js';
import { setMessageReaction } from './client.js';

const inflight = new Set();
const queuedNoticeAt = new Map();
const QUEUE_NOTICE_COOLDOWN_MS = 20_000;

function dropReply(reason) {
  if (reason === 'chat_full') {
    return 'You already have several messages waiting. I will get through those first, then you can send more.';
  }
  if (reason === 'global_full') {
    return 'A lot of people are messaging me at once. Hold on a bit and send that again.';
  }
  return 'I could not take that request right now. Try again in a moment.';
}

async function maybeNotifyQueued(jid, message, snapshot) {
  if (!snapshot?.notify) return;
  const last = queuedNoticeAt.get(jid) || 0;
  if (Date.now() - last < QUEUE_NOTICE_COOLDOWN_MS) return;
  queuedNoticeAt.set(jid, Date.now());
  const ahead = snapshot.chatsAhead || snapshot.activeChats || 1;
  const text = snapshot.waitingOnOthers
    ? `Got it. I am finishing ${ahead} other chat${ahead === 1 ? '' : 's'} first, then I will answer you.`
    : 'Got it. I am finishing your previous message first, then I will take this one.';
  try {
    await sendTelegramText(jid, text, wrapTelegramMessage(message));
  } catch (error) {
    logger.warn({ err: error, jid }, 'failed to send telegram queue notice');
  }
}

function buildTelegramEnvironment({ message, jid, pushName, group, mentioned, replyToBot, trigger, session, memoryJid }) {
  const quotedText = String(message?.reply_to_message?.text || message?.reply_to_message?.caption || '').trim();
  const environment = {
    type: group ? 'group' : 'dm',
    isGroup: Boolean(group),
    platform: TELEGRAM,
    trigger: trigger || 'message',
    mentioned: Boolean(mentioned),
    replyToBot: Boolean(replyToBot),
    botName: appConfig.bot.name,
    speaker: {
      name: pushName || null,
      jid: group ? `tguser:${message?.from?.id}` : jid,
    },
    group: group
      ? {
        id: jid,
        name: message?.chat?.title || null,
        description: null,
        participantCount: null,
      }
      : null,
    quoted: quotedText
      ? {
        text: quotedText.slice(0, 500),
        fromBot: Boolean(replyToBot),
        participant: message?.reply_to_message?.from?.id || null,
      }
      : null,
    linkedSession: session
      ? {
        id: session.id,
        memoryJid,
        otherPlatform: 'whatsapp',
      }
      : null,
  };
  return environment;
}

function formatTelegramEnvironmentPrompt(environment, session) {
  const lines = environment.isGroup
    ? [
      'Chat environment: you are in a Telegram group, not a private chat.',
      environment.group?.name ? `Group name: ${environment.group.name}` : null,
      environment.speaker?.name ? `The current speaker is ${environment.speaker.name}.` : null,
      'Keep replies concise and natural for a group. Do not pretend this is a 1:1 DM.',
    ]
    : [
      'Chat environment: this is a private Telegram direct message.',
      environment.speaker?.name ? `The user's display name is ${environment.speaker.name}.` : null,
    ];
  lines.push('You are talking on Telegram, not WhatsApp.');
  if (session) {
    lines.push(linkedEnvironmentNotes(session, TELEGRAM));
  }
  lines.push('Do not mention these environment notes.');
  return lines.filter(Boolean).join('\n');
}

async function processTelegramMessage(bot, message, ctx) {
  const {
    jid,
    text,
    pushName,
    group,
    mentioned,
    replyToBot,
    trigger,
    hasImage,
  } = ctx;

  const wrapped = wrapTelegramMessage(message, bot);
  const sock = createTelegramSock(bot, wrapped);
  const session = await resolveLinkedSession(TELEGRAM, jid);
  const memoryJid = memoryJidFor(TELEGRAM, jid, session);
  const environment = buildTelegramEnvironment({
    message,
    jid,
    pushName,
    group,
    mentioned,
    replyToBot,
    trigger,
    session,
    memoryJid,
  });
  environment.prompt = formatTelegramEnvironmentPrompt(environment, session);

  const prefix = telegramCommandPrefix();
  const promptText = group ? (stripTelegramMention(text, bot) || text) : text;

  logger.info(
    {
      jid,
      memoryJid,
      pushName,
      group,
      mentioned,
      replyToBot,
      trigger,
      linked: Boolean(session),
      text: String(text || '').slice(0, 200),
    },
    'incoming Telegram message',
  );

  if (group && telegramConfig.reactInGroups !== false && promptText && !promptText.startsWith(prefix)) {
    const quickReaction = pickGroupReaction(promptText);
    if (quickReaction) {
      try {
        await setMessageReaction(message.chat.id, message.message_id, quickReaction);
      } catch (error) {
        logger.debug({ err: error, jid }, 'telegram reaction failed');
      }
    }
  }

  if (telegramConfig.typingIndicator) {
    await showTelegramTyping(jid);
  }

  if (!group) {
    rememberUser(memoryJid, pushName).catch((error) => {
      logger.warn({ err: error, jid }, 'failed to persist telegram user');
    });
  }

  const commandReply = promptText && promptText.startsWith(prefix)
      ? await tryHandleCommand({
      text: promptText,
      jid,
      memoryJid,
      nativeJid: jid,
      pushName,
      sock,
      message: wrapped,
      environment,
      platform: TELEGRAM,
    })
    : null;

  let image = null;
  const vision = getAiRuntime().imageSupport;
  if (commandReply == null && hasImage && vision) {
    image = await downloadTelegramImage(message);
  }

  const replyTextInput = promptText
    || (image ? '' : (hasImage ? 'The user sent an image.' : (hasTelegramAttachment(message) ? 'The user sent a file.' : '')));

  const reply = commandReply == null
    ? await generateReply({
      jid,
      memoryJid,
      text: replyTextInput,
      pushName,
      sock,
      message: wrapped,
      environment,
      image,
    })
    : (typeof commandReply === 'object' && commandReply
      ? commandReply
      : { text: commandReply, artifacts: [] });

  const artifacts = reply.artifacts || [];
  const replyText = String((typeof reply === 'string' ? reply : reply.text) || '').trim()
    || (artifacts.length ? "I've finished." : 'I could not finish that reply. Send it again and I will try a shorter pass.');

  if (artifacts.length) {
    await sendTelegramArtifacts(jid, artifacts, wrapped);
  }
  await sendTelegramText(jid, replyText, wrapped);

  if (session && commandReply == null) {
    await touchSessionUse(session, TELEGRAM, { lastMessagePreview: replyText.slice(0, 120) });
  }

  logger.info(
    {
      jid,
      memoryJid,
      files: artifacts.length,
      group,
      reply: replyText.slice(0, 400),
    },
    'sent Telegram reply',
  );
}

export async function handleTelegramUpdate(bot, update) {
  const message = update?.message || update?.edited_message;
  if (!message || message.from?.is_bot) return;

  const chatId = message.chat?.id;
  if (!chatId) return;

  const text = extractTelegramText(message);
  const hasImage = hasTelegramImage(message);
  const hasFile = hasTelegramAttachment(message);
  if (!text && !hasImage && !hasFile) return;

  const jid = `tg:${chatId}`;
  const messageId = `${jid}:${message.message_id}`;
  if (inflight.has(messageId)) return;
  inflight.add(messageId);

  const group = isTelegramGroup(message.chat);
  const pushName = displayName(message.from);
  const addressing = shouldReplyToTelegram(message, bot);
  const { shouldReply, mentioned, replyToBot, trigger } = addressing;
  const wrapped = wrapTelegramMessage(message, bot);

  try {
    const shouldLog = (!group || telegramConfig.logGroupMessages !== false);
    const session = shouldReply && !group ? await resolveLinkedSession(TELEGRAM, jid) : null;
    const memoryJid = memoryJidFor(TELEGRAM, jid, session);
    if (shouldLog) {
      const logPromise = logTelegramMessage(message, {
        jid,
        text,
        pushName,
        replied: shouldReply,
        mentioned,
        replyToBot,
      }).then(async () => {
        if (session && memoryJid && memoryJid !== jid && text) {
          await addMessage({
            jid: memoryJid,
            role: 'user',
            content: text,
            metadata: {
              pushName,
              source: 'telegram',
              platform: 'telegram',
              linked: true,
              telegramJid: jid,
              replied: shouldReply,
            },
          });
        }
      });
      if (shouldReply) await logPromise;
      else logPromise.catch((error) => logger.warn({ err: error, jid }, 'failed to log telegram chat'));
    }

    if (!shouldReply) return;

    const queued = await enqueueChatWork({
      jid,
      run: () => processTelegramMessage(bot, message, {
        jid,
        text,
        pushName,
        group,
        mentioned,
        replyToBot,
        trigger,
        hasImage,
      }),
      onQueued: (snapshot) => maybeNotifyQueued(jid, message, snapshot),
    });

    if (queued?.dropped) {
      logger.info({ jid, reason: queued.reason }, 'dropped queued Telegram request');
      await sendTelegramText(jid, dropReply(queued.reason), wrapped);
    }
  } catch (error) {
    logger.error({ err: error, jid }, 'failed to generate or send telegram reply');
    try {
      await sendTelegramText(jid, 'Sorry, I ran into a problem handling that message. Try sending it again.', wrapped);
    } catch (sendError) {
      logger.error({ err: sendError, jid }, 'failed to send telegram error reply');
    }
  } finally {
    inflight.delete(messageId);
  }
}
