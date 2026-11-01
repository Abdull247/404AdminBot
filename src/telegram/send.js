import fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { parseTelegramChatId } from './ids.js';
import { toTelegramHtml } from './markdown.js';
import {
  sendAudio,
  sendChatAction,
  sendDocument,
  sendMessage,
  sendPhoto,
  sendSticker,
  sendVideo,
  setMessageReaction,
} from './client.js';

function fileExists(filePath) {
  try {
    return Boolean(filePath) && fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readMedia(filePath) {
  if (!fileExists(filePath)) return null;
  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    logger.warn({ err: error, filePath }, 'failed to read telegram media file');
    return null;
  }
}

function replyId(quoted) {
  return quoted?.telegram?.message_id || quoted?.key?.id || null;
}

export async function sendTelegramText(jid, text, quoted) {
  const chatId = parseTelegramChatId(jid);
  const html = toTelegramHtml(text);
  try {
    return await sendMessage(chatId, html || text, {
      replyToMessageId: replyId(quoted),
    });
  } catch (error) {
    logger.warn({ err: error, jid }, 'telegram html send failed, retrying plain text');
    return sendMessage(chatId, text, {
      parseMode: '',
      replyToMessageId: replyId(quoted),
    });
  }
}

export async function sendTelegramArtifacts(jid, artifacts = [], quoted) {
  const chatId = parseTelegramChatId(jid);
  for (const file of artifacts) {
    if (!file?.ok || !file.path || !fileExists(file.path)) continue;
    const mime = String(file.mimetype || '').toLowerCase();
    const buffer = readMedia(file.path);
    if (!buffer) continue;
    const extra = {
      filename: file.filename,
      mimetype: file.mimetype,
      caption: file.caption || file.filename,
      replyToMessageId: replyId(quoted),
    };
    try {
      if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
        await sendPhoto(chatId, buffer, extra);
      } else if (mime.startsWith('video/')) {
        await sendVideo(chatId, buffer, extra);
      } else if (mime.startsWith('audio/')) {
        await sendAudio(chatId, buffer, extra);
      } else if (mime === 'image/webp' || file.sticker) {
        await sendSticker(chatId, buffer, extra);
      } else {
        await sendDocument(chatId, buffer, extra);
      }
      logger.info({ jid, filename: file.filename, mime }, 'sent telegram file');
    } catch (error) {
      logger.error({ err: error, jid, filename: file.filename }, 'failed to send telegram file');
    }
  }
}

export async function sendTelegramContent(jid, content, quoted) {
  if (content?.react) {
    const chatId = parseTelegramChatId(jid);
    const messageId = content.react.key?.id || quoted?.telegram?.message_id;
    if (messageId) {
      await setMessageReaction(chatId, Number(messageId), content.react.text || '');
    }
    return true;
  }
  if (content?.sticker) {
    const chatId = parseTelegramChatId(jid);
    const buffer = Buffer.isBuffer(content.sticker) ? content.sticker : readMedia(content.sticker.url || content.sticker);
    if (buffer) {
      await sendSticker(chatId, buffer, { replyToMessageId: replyId(quoted) });
    }
    return true;
  }
  if (content?.image) {
    const chatId = parseTelegramChatId(jid);
    const buffer = Buffer.isBuffer(content.image) ? content.image : readMedia(content.image.url);
    if (buffer) {
      await sendPhoto(chatId, buffer, {
        filename: content.fileName,
        mimetype: content.mimetype,
        caption: content.caption,
        replyToMessageId: replyId(quoted),
      });
    }
    return true;
  }
  if (content?.video) {
    const chatId = parseTelegramChatId(jid);
    const source = content.video.url || content.video;
    const buffer = Buffer.isBuffer(source) ? source : readMedia(source);
    if (buffer) {
      await sendVideo(chatId, buffer, {
        filename: content.fileName,
        mimetype: content.mimetype,
        caption: content.caption,
        replyToMessageId: replyId(quoted),
      });
    }
    return true;
  }
  if (content?.audio) {
    const chatId = parseTelegramChatId(jid);
    const buffer = Buffer.isBuffer(content.audio) ? content.audio : readMedia(content.audio.url);
    if (buffer) {
      await sendAudio(chatId, buffer, {
        filename: content.fileName,
        mimetype: content.mimetype,
        replyToMessageId: replyId(quoted),
      });
    }
    return true;
  }
  if (content?.document) {
    const chatId = parseTelegramChatId(jid);
    const buffer = Buffer.isBuffer(content.document) ? content.document : readMedia(content.document.url);
    if (buffer) {
      await sendDocument(chatId, buffer, {
        filename: content.fileName,
        mimetype: content.mimetype,
        caption: content.caption,
        replyToMessageId: replyId(quoted),
      });
    }
    return true;
  }
  if (content?.text) {
    await sendTelegramText(jid, content.text, quoted);
    return true;
  }
  return false;
}

export async function showTelegramTyping(jid) {
  const chatId = parseTelegramChatId(jid);
  if (chatId) await sendChatAction(chatId, 'typing');
}
