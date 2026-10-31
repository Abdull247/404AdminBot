import fs from 'node:fs';
import { logger } from '../utils/logger.js';

export async function sendArtifacts(sock, jid, artifacts = [], quoted) {
  for (const file of artifacts) {
    if (!file?.ok || !file.path || !fs.existsSync(file.path)) continue;
    const mime = String(file.mimetype || '').toLowerCase();
    const isImage = mime.startsWith('image/') && mime !== 'image/svg+xml';
    const isVideo = mime.startsWith('video/');
    const options = quoted ? { quoted } : undefined;
    try {
      const payload = isImage
        ? {
            image: fs.readFileSync(file.path),
            fileName: file.filename,
            mimetype: file.mimetype,
            caption: file.caption || file.filename,
          }
        : isVideo
          ? {
              video: fs.createReadStream(file.path),
              fileName: file.filename,
              mimetype: file.mimetype || 'video/mp4',
              caption: file.caption || file.filename,
            }
          : {
              document: fs.readFileSync(file.path),
              fileName: file.filename,
              mimetype: file.mimetype || 'text/plain',
            };
      await sock.sendMessage(jid, payload, options);
      logger.info({ jid, filename: file.filename, mime }, 'sent generated file');
    } catch (error) {
      if (isVideo) {
        try {
          await sock.sendMessage(jid, {
            document: fs.readFileSync(file.path),
            fileName: file.filename,
            mimetype: file.mimetype || 'video/mp4',
          }, options);
          logger.info({ jid, filename: file.filename }, 'sent video as document after video send failed');
          continue;
        } catch (docError) {
          logger.error({ err: docError, jid, filename: file.filename }, 'failed to send video document fallback');
        }
      }
      logger.error({ err: error, jid, filename: file.filename }, 'failed to send generated file');
    }
  }
}
