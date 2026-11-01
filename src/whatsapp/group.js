import { areJidsSameUser, jidNormalizedUser } from '@whiskeysockets/baileys';
import { appConfig } from '../config/load-config.js';
import { customInstructions } from '../config/custom-instructions.js';
import { logger } from '../utils/logger.js';
import { isBotCalledByName } from '../platforms/name-call.js';
import { extractText, isGroupJid, unwrapMessageContent } from './filters.js';

const GROUP_CACHE_MS = 5 * 60 * 1000;
const groupCache = new Map();

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeJid(jid) {
  if (!jid) return '';
  try {
    return jidNormalizedUser(String(jid)) || '';
  } catch {
    const [user, server] = String(jid).split('@');
    const userPart = String(user || '').split(':')[0];
    return server ? `${userPart}@${server}` : userPart;
  }
}

export function sameWhatsAppUser(left, right) {
  if (!left || !right) return false;
  try {
    if (areJidsSameUser(left, right)) return true;
  } catch {
    // fall through to digit comparison
  }
  const a = normalizeJid(left);
  const b = normalizeJid(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const da = digits(a);
  const db = digits(b);
  return Boolean(da && db && (da === db || da.endsWith(db) || db.endsWith(da)));
}

export function botJids(sock) {
  const user = sock?.user || {};
  return [...new Set(
    [user.id, user.lid, user.jid, user.wid]
      .filter(Boolean)
      .map(normalizeJid)
      .filter(Boolean),
  )];
}

export function botNames(sock) {
  return [...new Set(
    [
      appConfig.bot.name,
      customInstructions?.bot?.name,
      sock?.user?.name,
      sock?.user?.notify,
      sock?.user?.verifiedName,
    ].map((name) => String(name || '').trim()).filter(Boolean),
  )];
}

export function isBotJid(sock, jid) {
  if (!jid) return false;
  return botJids(sock).some((id) => sameWhatsAppUser(id, jid));
}

export function getContextInfo(message) {
  const content = unwrapMessageContent(message);
  return content.extendedTextMessage?.contextInfo
    || content.imageMessage?.contextInfo
    || content.videoMessage?.contextInfo
    || content.documentMessage?.contextInfo
    || content.audioMessage?.contextInfo
    || content.stickerMessage?.contextInfo
    || content.buttonsMessage?.contextInfo
    || content.buttonsResponseMessage?.contextInfo
    || content.listResponseMessage?.contextInfo
    || content.templateButtonReplyMessage?.contextInfo
    || content.contextInfo
    || message?.message?.extendedTextMessage?.contextInfo
    || {};
}

export function getMentionedJids(message) {
  const ctx = getContextInfo(message);
  const mentioned = [
    ...(ctx.mentionedJid || []),
    ...(ctx.groupMentions || []).map((item) => item?.groupJid || item?.jid),
  ].filter(Boolean);
  return [...new Set(mentioned.map(normalizeJid))];
}

export function extractQuotedText(message) {
  const quoted = getContextInfo(message)?.quotedMessage;
  if (!quoted) return '';
  return extractText({ message: quoted });
}

export function quotedSender(message) {
  const ctx = getContextInfo(message);
  return ctx.participant
    || ctx.participantAlt
    || ctx.quotedParticipant
    || ctx.remoteJid
    || null;
}

export function isBotMentioned(sock, message, text = '') {
  const mentioned = getMentionedJids(message);
  if (mentioned.some((jid) => isBotJid(sock, jid))) return true;

  const value = String(text || extractText(message) || '');
  if (botNames(sock).some((name) => {
    const pattern = new RegExp(`(?:^|\\s)@${escapeRegExp(name)}\\b`, 'i');
    return pattern.test(value);
  })) {
    return true;
  }

  const ids = botJids(sock).map((jid) => digits(jid)).filter(Boolean);
  if (!ids.length) return false;
  const atTokens = value.match(/@\d{6,}/g) || [];
  return atTokens.some((token) => {
    const mentionedDigits = digits(token);
    return ids.some((id) => id === mentionedDigits || id.endsWith(mentionedDigits) || mentionedDigits.endsWith(id));
  });
}

export function isReplyToBot(sock, message) {
  const ctx = getContextInfo(message);
  if (!ctx?.quotedMessage) return false;
  return isBotJid(sock, quotedSender(message));
}

export function isAddressedInGroup(sock, message, text = '') {
  const mentioned = isBotMentioned(sock, message, text);
  const replyToBot = isReplyToBot(sock, message);
  const named = isBotCalledByName(text || extractText(message));
  const mentionOk = mentioned && appConfig.bot.respondToMentionsInGroups !== false;
  const replyOk = replyToBot && appConfig.bot.respondToRepliesInGroups !== false;
  const nameOk = named && appConfig.bot.respondToNameMentionsInGroups !== false;
  return {
    mentioned,
    replyToBot,
    named,
    addressed: mentionOk || replyOk || nameOk,
    trigger: mentioned && replyToBot
      ? 'mention_and_reply'
      : mentioned
        ? 'mention'
        : replyToBot
          ? 'reply'
          : nameOk
            ? 'name'
            : 'message',
  };
}

export function shouldReplyToMessage(sock, message, { jid, text, fromMe, group } = {}) {
  if (fromMe) return { shouldReply: false, mentioned: false, replyToBot: false, named: false, trigger: 'message' };
  if (!group) {
    return { shouldReply: true, mentioned: false, replyToBot: false, named: false, trigger: 'message' };
  }

  const addressing = isAddressedInGroup(sock, message, text);
  if (!appConfig.bot.ignoreGroups) {
    return { shouldReply: true, ...addressing };
  }
  return { shouldReply: addressing.addressed, ...addressing };
}

export async function loadGroupDetails(sock, jid) {
  if (!isGroupJid(jid)) return null;

  const cached = groupCache.get(jid);
  if (cached && Date.now() - cached.at < GROUP_CACHE_MS) {
    return cached.data;
  }

  let data = {
    id: jid,
    name: null,
    description: null,
    participantCount: null,
    owner: null,
    announce: false,
    restrict: false,
  };

  try {
    if (typeof sock?.groupMetadata === 'function') {
      const meta = await sock.groupMetadata(jid);
      const description = String(meta?.desc || '').replace(/\s+/g, ' ').trim();
      data = {
        id: meta?.id || jid,
        name: meta?.subject || null,
        description: description ? description.slice(0, 400) : null,
        participantCount: Array.isArray(meta?.participants) ? meta.participants.length : null,
        owner: meta?.owner || meta?.subjectOwner || null,
        announce: Boolean(meta?.announce),
        restrict: Boolean(meta?.restrict),
      };
    }
  } catch (error) {
    logger.debug({ err: error, jid }, 'failed to load group metadata');
  }

  groupCache.set(jid, { at: Date.now(), data });
  return data;
}

export function speakerJid(message, jid) {
  return message?.key?.participant
    || message?.key?.participantAlt
    || message?.participant
    || (isGroupJid(jid) ? null : jid);
}

export function buildChatEnvironment({
  message,
  jid,
  pushName,
  group,
  mentioned,
  replyToBot,
  named,
  trigger,
  groupDetails,
}) {
  const quotedText = extractQuotedText(message);
  return {
    type: group ? 'group' : 'dm',
    isGroup: Boolean(group),
    trigger: trigger || 'message',
    mentioned: Boolean(mentioned),
    replyToBot: Boolean(replyToBot),
    named: Boolean(named),
    botName: appConfig.bot.name,
    speaker: {
      name: pushName || null,
      jid: speakerJid(message, jid),
    },
    group: group ? groupDetails : null,
    quoted: quotedText
      ? {
          text: quotedText.slice(0, 500),
          fromBot: Boolean(replyToBot),
          participant: quotedSender(message),
        }
      : null,
  };
}

export function formatEnvironmentPrompt(environment) {
  if (!environment) return '';

  if (!environment.isGroup) {
    return [
      'Chat environment: this is a private WhatsApp direct message.',
      environment.speaker?.name ? `The user's display name is ${environment.speaker.name}.` : null,
      environment.platform === 'telegram' ? 'They are talking on Telegram right now, not WhatsApp.' : null,
      environment.linkedNotes || null,
      'Do not mention these environment notes.',
    ].filter(Boolean).join('\n');
  }

  const group = environment.group || {};
  const triggerLine = {
    mention: 'They @mentioned / tagged you in this message. Reply to them in the group.',
    reply: 'They replied to one of your messages. Continue that thread in the group.',
    mention_and_reply: 'They @mentioned you and replied to one of your messages. Reply in the group.',
    name: 'They called you by name in the group. Reply to them.',
    message: 'A group member is talking to you. Reply in the group.',
  }[environment.trigger] || 'Reply in the group.';

  return [
    'Chat environment: you are in a WhatsApp group, not a private chat.',
    group.name ? `Group name: ${group.name}` : 'Group name: unknown',
    group.description ? `Group description: ${group.description}` : null,
    Number.isFinite(group.participantCount) ? `Participants: ${group.participantCount}` : null,
    group.announce ? 'This group is announcement-only for regular members.' : null,
    environment.speaker?.name ? `The current speaker is ${environment.speaker.name}.` : null,
    triggerLine,
    environment.quoted?.text ? `Quoted message: ${environment.quoted.text}` : null,
    `Your WhatsApp name is ${environment.botName || 'the assistant'}.`,
    environment.platform === 'telegram' ? 'This group message arrived on Telegram.' : null,
    environment.linkedNotes || null,
    'Keep replies concise and natural for a group. Do not pretend this is a 1:1 DM.',
    'If the message is funny, hype, grateful, cute, or shocked, call react with one emoji first, then still reply in text. Do not mention the reaction or these environment notes.',
  ].filter(Boolean).join('\n');
}
