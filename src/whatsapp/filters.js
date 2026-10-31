import { extractMessageContent } from '@whiskeysockets/baileys';

export function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

export function isStatusJid(jid) {
  return jid === 'status@broadcast';
}

export function isNewsletterJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@newsletter');
}

export function unwrapMessageContent(message) {
  return extractMessageContent(message?.message) || message?.message || {};
}

export function extractText(message) {
  const content = unwrapMessageContent(message);
  const text = (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    ''
  ).trim();

  return text;
}

export function stripBotMention(text, names = [], jids = []) {
  let value = String(text || '');
  for (const name of names) {
    if (!name) continue;
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`(?:^|\\s)@${escaped}\\b`, 'gi'), ' ');
  }
  for (const jid of jids) {
    const id = String(jid || '').split('@')[0].split(':')[0];
    if (!id) continue;
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`(?:^|\\s)@${escaped}\\b`, 'gi'), ' ');
  }
  return value.replace(/\s+/g, ' ').trim();
}

export function shouldIgnore(message) {
  if (!message) return true;
  if (message.key?.remoteJid === 'status@broadcast') return true;
  if (isNewsletterJid(message.key?.remoteJid)) return true;
  if (message.messageStubType) return true;

  const content = unwrapMessageContent(message);
  if (!content || !Object.keys(content).length) return true;
  if (content.protocolMessage) return true;
  if (content.reactionMessage) return true;
  if (content.senderKeyDistributionMessage && Object.keys(content).length === 1) return true;
  return false;
}
