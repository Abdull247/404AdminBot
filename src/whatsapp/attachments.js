import crypto from 'node:crypto';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { isGroupJid, isNewsletterJid, unwrapMessageContent } from './filters.js';
import { createStoredFile } from '../db/repositories/files.js';
import { logger } from '../utils/logger.js';
import { makeObjectKey, r2Configured, uploadR2Object } from '../storage/r2.js';

export function getIncomingAttachment(message) {
  const content = unwrapMessageContent(message);
  return content.documentMessage || content.imageMessage || content.videoMessage || null;
}

export function hasIncomingAttachment(message) {
  return Boolean(getIncomingAttachment(message));
}

export async function storeIncomingFile(sock, message, jid) {
  if (!r2Configured()) return null;
  if (isNewsletterJid(jid) || isNewsletterJid(message?.key?.remoteJid)) return null;
  const attachment = getIncomingAttachment(message);
  if (!attachment) return null;

  const mimetype = String(attachment.mimetype || 'application/octet-stream').split(';')[0].trim();
  const ext = (mimetype.split('/')[1] || 'file').replace(/[^a-zA-Z0-9]/g, '');
  const filename = String(
    attachment.fileName
    || attachment.title
    || `${mimetype.split('/')[0] || 'file'}-${Date.now()}.${ext || 'bin'}`,
  );

  let buffer;
  try {
    buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: sock?.updateMediaMessage,
      },
    );
  } catch (error) {
    logger.warn({ err: error, jid }, 'failed to download incoming attachment');
    return null;
  }
  if (!buffer || !buffer.length) return null;

  const key = makeObjectKey(jid, filename);
  const uploaded = await uploadR2Object({ key, body: buffer, contentType: mimetype });
  const record = await createStoredFile({
    id: crypto.randomUUID(),
    jid,
    chatType: isGroupJid(jid) ? 'group' : 'dm',
    filename,
    key,
    url: uploaded.url,
    mimetype,
    size: buffer.length,
    source: 'user_upload',
    metadata: {},
  });
  logger.info({ jid, filename, bytes: buffer.length }, 'stored incoming user file');
  return record;
}
