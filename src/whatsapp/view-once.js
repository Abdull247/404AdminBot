import { downloadMediaMessage, extractMessageContent } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.js';

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

function unwrapWrappers(content) {
  let current = content;
  let viaViewOnce = false;

  for (let i = 0; i < 8 && current; i += 1) {
    if (
      current.viewOnceMessage
      || current.viewOnceMessageV2
      || current.viewOnceMessageV2Extension
    ) {
      viaViewOnce = true;
    }

    const next = current.ephemeralMessage?.message
      || current.documentWithCaptionMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.editedMessage?.message;

    if (!next) break;
    current = next;
  }

  return { content: current, viaViewOnce };
}

function contextInfo(message) {
  let content;
  try {
    content = extractMessageContent(message?.message) || message?.message || {};
  } catch {
    content = message?.message || {};
  }

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

export function findViewOnceImage(content) {
  if (!content || typeof content !== 'object') return null;
  const { content: inner, viaViewOnce } = unwrapWrappers(content);
  const image = inner?.imageMessage || null;
  if (!image) return null;
  if (viaViewOnce || image.viewOnce === true) {
    return { image, viaViewOnce };
  }
  return null;
}

export function quotedViewOnceImage(message) {
  const info = contextInfo(message);
  return findViewOnceImage(info?.quotedMessage);
}

export function currentViewOnceImage(message) {
  return findViewOnceImage(message?.message);
}

export function resolveViewOnceTarget(message, { prefer = 'quoted' } = {}) {
  const order = prefer === 'current' ? ['current', 'quoted'] : ['quoted', 'current'];

  for (const source of order) {
    if (source === 'quoted') {
      const info = contextInfo(message);
      const hit = findViewOnceImage(info?.quotedMessage);
      if (hit) {
        return {
          source,
          image: hit.image,
          content: info.quotedMessage,
          key: {
            remoteJid: message?.key?.remoteJid || null,
            id: info?.stanzaId || null,
            participant: info?.participant || null,
            fromMe: false,
          },
        };
      }
      continue;
    }

    const hit = findViewOnceImage(message?.message);
    if (hit) {
      return {
        source,
        image: hit.image,
        content: message.message,
        key: message?.key || null,
      };
    }
  }

  return null;
}

export async function downloadViewOnceImage(sock, target) {
  if (!target?.content) {
    throw new Error('No view-once image to open.');
  }

  const mediaMessage = {
    key: target.key || { remoteJid: null, id: null },
    message: target.content,
  };

  const buffer = await downloadMediaMessage(
    mediaMessage,
    'buffer',
    {},
    {
      logger,
      reuploadRequest: sock?.updateMediaMessage,
    },
  );

  if (!buffer?.length) {
    throw new Error('The view-once image came back empty.');
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('The view-once image is too large to resend.');
  }

  const mimetype = String(target.image?.mimetype || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
  return {
    buffer,
    mimetype,
    caption: String(target.image?.caption || '').trim(),
    bytes: buffer.length,
  };
}