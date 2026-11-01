import fs from 'node:fs';
import { findSticker, listStickers } from '../../../config/stickers.js';
import { logger } from '../../../utils/logger.js';

function summarize(sticker, detail = false) {
  const base = {
    id: sticker.id,
    name: sticker.name,
    folder: sticker.folder,
    path: sticker.path,
    description: sticker.description,
    tags: sticker.tags,
  };
  if (!detail) return base;
  return {
    ...base,
    whenToUse: sticker.whenToUse,
    whenNotToUse: sticker.whenNotToUse,
  };
}

export async function handler(args = {}, context = {}) {
  const action = String(args.action || (args.id ? 'send' : 'list')).trim().toLowerCase();

  if (action === 'list' || action === 'available' || action === 'catalog') {
    const stickers = listStickers();
    return {
      ok: true,
      action: 'list',
      count: stickers.length,
      stickers: stickers.map((sticker) => summarize(sticker, true)),
    };
  }

  if (action !== 'send') {
    return { ok: false, error: 'action must be list or send' };
  }

  const sticker = findSticker(args.id || args.sticker || args.name || args.folder);
  if (!sticker) {
    return {
      ok: false,
      error: 'unknown sticker id',
      available: listStickers().map((item) => summarize(item)),
    };
  }

  if (!context.sock || !context.jid) {
    return { ok: false, error: 'no chat to send a sticker to' };
  }
  if (!fs.existsSync(sticker.absPath)) {
    return { ok: false, error: `sticker file missing: ${sticker.path}` };
  }

  try {
    await context.sock.sendMessage(
      context.jid,
      { sticker: fs.readFileSync(sticker.absPath), mimetype: 'image/webp' },
      context.message ? { quoted: context.message } : undefined,
    );
    logger.info({ jid: context.jid, id: sticker.id }, 'sent WhatsApp sticker');
    return { ok: true, action: 'send', ...summarize(sticker) };
  } catch (error) {
    logger.error({ err: error, id: sticker.id, jid: context.jid }, 'failed to send sticker');
    return { ok: false, error: error.message };
  }
}
