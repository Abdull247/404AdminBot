import { logger } from '../../../utils/logger.js';
import { WHATSAPP } from '../../../platforms/ids.js';
import { downloadViewOnceImage, resolveViewOnceTarget } from '../../../whatsapp/view-once.js';

function isWhatsApp(context = {}) {
  if (context.platform && context.platform !== WHATSAPP) return false;
  if (context.sock?.platform && context.sock.platform !== WHATSAPP) return false;
  if (context.message?.telegram) return false;
  return true;
}

export async function handler(args = {}, context = {}) {
  if (!isWhatsApp(context)) {
    return { ok: false, error: 'Opening view-once images only works on WhatsApp.' };
  }
  if (!context.sock || !context.jid) {
    return { ok: false, error: 'There is no chat to send the image to.' };
  }

  const prefer = String(args.source || 'quoted').toLowerCase() === 'current' ? 'current' : 'quoted';
  const target = resolveViewOnceTarget(context.message, { prefer });
  if (!target) {
    return {
      ok: false,
      error: 'No view-once image found. Reply to the view-once image, or send it and use source=current.',
    };
  }

  try {
    const media = await downloadViewOnceImage(context.sock, target);
    const caption = String(args.caption || media.caption || '').trim();
    await context.sock.sendMessage(
      context.jid,
      {
        image: media.buffer,
        mimetype: media.mimetype,
        ...(caption ? { caption } : {}),
      },
      context.message ? { quoted: context.message } : undefined,
    );

    logger.info(
      { jid: context.jid, source: target.source, bytes: media.bytes },
      'sent unwrapped view-once image',
    );
    return {
      ok: true,
      action: 'unwrap',
      source: target.source,
      mimetype: media.mimetype,
      bytes: media.bytes,
      caption: caption || null,
    };
  } catch (error) {
    logger.error({ err: error, jid: context.jid }, 'failed to unwrap view-once image');
    return { ok: false, error: `Could not open that view-once image: ${error.message}` };
  }
}