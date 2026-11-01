import { telegramConfig } from '../config/telegram.js';
import { logger } from '../utils/logger.js';

const API_ROOT = 'https://api.telegram.org';

function endpoint(method) {
  return `${API_ROOT}/bot${telegramConfig.token}/${method}`;
}

async function call(method, payload = {}, { form = false } = {}) {
  const url = endpoint(method);
  const init = form
    ? { method: 'POST', body: payload }
    : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    };
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const description = data?.description || `HTTP ${response.status}`;
    const error = new Error(`Telegram ${method} failed: ${description}`);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data.result;
}

export async function getMe() {
  return call('getMe');
}

export async function getUpdates({ offset, timeout, limit } = {}) {
  return call('getUpdates', {
    offset,
    timeout: timeout ?? telegramConfig.polling.timeoutSeconds,
    limit: limit ?? telegramConfig.polling.limit,
    allowed_updates: ['message', 'edited_message'],
  });
}

export async function sendChatAction(chatId, action = 'typing') {
  try {
    await call('sendChatAction', { chat_id: chatId, action });
  } catch (error) {
    logger.debug({ err: error, chatId, action }, 'telegram sendChatAction failed');
  }
}

export async function sendMessage(chatId, text, extra = {}) {
  const payload = {
    chat_id: chatId,
    text,
    reply_to_message_id: extra.replyToMessageId,
    disable_web_page_preview: extra.disablePreview === true,
  };
  if (extra.parseMode !== '') {
    payload.parse_mode = extra.parseMode || telegramConfig.parseMode || undefined;
  }
  return call('sendMessage', payload);
}

export async function sendPhoto(chatId, buffer, extra = {}) {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('photo', new Blob([buffer], { type: extra.mimetype || 'image/jpeg' }), extra.filename || 'photo.jpg');
  if (extra.caption) form.set('caption', extra.caption);
  if (extra.parseMode) form.set('parse_mode', extra.parseMode);
  if (extra.replyToMessageId) form.set('reply_to_message_id', String(extra.replyToMessageId));
  return call('sendPhoto', form, { form: true });
}

export async function sendDocument(chatId, buffer, extra = {}) {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('document', new Blob([buffer], { type: extra.mimetype || 'application/octet-stream' }), extra.filename || 'file.bin');
  if (extra.caption) form.set('caption', extra.caption);
  if (extra.parseMode) form.set('parse_mode', extra.parseMode);
  if (extra.replyToMessageId) form.set('reply_to_message_id', String(extra.replyToMessageId));
  return call('sendDocument', form, { form: true });
}

export async function sendAudio(chatId, buffer, extra = {}) {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('audio', new Blob([buffer], { type: extra.mimetype || 'audio/mpeg' }), extra.filename || 'audio.mp3');
  if (extra.caption) form.set('caption', extra.caption);
  if (extra.replyToMessageId) form.set('reply_to_message_id', String(extra.replyToMessageId));
  return call('sendAudio', form, { form: true });
}

export async function sendVideo(chatId, buffer, extra = {}) {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('video', new Blob([buffer], { type: extra.mimetype || 'video/mp4' }), extra.filename || 'video.mp4');
  if (extra.caption) form.set('caption', extra.caption);
  if (extra.replyToMessageId) form.set('reply_to_message_id', String(extra.replyToMessageId));
  return call('sendVideo', form, { form: true });
}

export async function sendSticker(chatId, buffer, extra = {}) {
  const form = new FormData();
  form.set('chat_id', String(chatId));
  form.set('sticker', new Blob([buffer], { type: extra.mimetype || 'image/webp' }), extra.filename || 'sticker.webp');
  if (extra.replyToMessageId) form.set('reply_to_message_id', String(extra.replyToMessageId));
  return call('sendSticker', form, { form: true });
}

export async function setMessageReaction(chatId, messageId, emoji) {
  const reaction = emoji
    ? [{ type: 'emoji', emoji }]
    : [];
  return call('setMessageReaction', {
    chat_id: chatId,
    message_id: messageId,
    reaction,
  });
}

export async function getFile(fileId) {
  return call('getFile', { file_id: fileId });
}

export async function downloadFile(filePath) {
  const url = `${API_ROOT}/file/bot${telegramConfig.token}/${filePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
