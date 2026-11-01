import { logger } from '../utils/logger.js';
import { downloadFile, getFile } from './client.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function bestPhoto(message) {
  const photos = message?.photo;
  if (!Array.isArray(photos) || !photos.length) return null;
  return photos[photos.length - 1];
}

export function hasTelegramImage(message) {
  return Boolean(message?.photo?.length || (message?.document && String(message.document.mime_type || '').startsWith('image/')));
}

export function hasTelegramAttachment(message) {
  return Boolean(
    message?.photo?.length
    || message?.document
    || message?.video
    || message?.audio
    || message?.voice
    || message?.sticker,
  );
}

export async function downloadTelegramImage(message) {
  const photo = bestPhoto(message);
  const imageDoc = message?.document && String(message.document.mime_type || '').startsWith('image/')
    ? message.document
    : null;
  const fileId = photo?.file_id || imageDoc?.file_id;
  if (!fileId) return null;
  try {
    const meta = await getFile(fileId);
    const buffer = await downloadFile(meta.file_path);
    if (!buffer?.length) return null;
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(`image is too large (${buffer.length} bytes)`);
    }
    const mimetype = imageDoc?.mime_type || 'image/jpeg';
    return {
      mimetype,
      base64: buffer.toString('base64'),
      size: buffer.length,
      caption: String(message.caption || '').trim(),
    };
  } catch (error) {
    logger.warn({ err: error }, 'failed to download telegram image');
    return null;
  }
}
