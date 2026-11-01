import { logger } from '../utils/logger.js';
import { WHATSAPP } from '../platforms/ids.js';
import { downloadViewOnceImage, resolveViewOnceTarget } from '../whatsapp/view-once.js';

function platformOf(context = {}) {
  return context.platform || context.sock?.platform || WHATSAPP;
}

export async function handleUnwrapViewOnce(context = {}) {
  if (platformOf(context) !== WHATSAPP) {
    return 'Opening view-once images only works on WhatsApp.';
  }
  if (!context.sock || !context.jid) {
    return 'There is no chat to send the image to.';
  }

  const prefer = /^current\b/i.test(String(context.arg || '')) ? 'current' : 'quoted';
  const target = resolveViewOnceTarget(context.message, { prefer });
  if (!target) {
    return 'Reply to a view-once image with this command, or send the view-once image and use .unwrap current.';
  }

  try {
    const media = await downloadViewOnceImage(context.sock, target);
    const caption = media.caption || '';
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
      'unwrap command sent view-once image',
    );
    return 'Here is the view-once image as a normal photo.';
  } catch (error) {
    logger.error({ err: error, jid: context.jid }, 'unwrap command failed');
    return `Could not open that view-once image: ${error.message}`;
  }
}