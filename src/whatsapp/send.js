import fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

function mediaUploadTimeoutMs() {
  return env.REELIX_VIDEO_TIMEOUT_MS || 300000;
}

export async function sendArtifacts(sock, jid, artifacts = [], quoted) {
  for (const file of artifacts) {
    if (!file?.ok || !file.path || !fs.existsSync(file.path)) continue;
    const mime = String(file.mimetype || '').toLowerCase();
    const isImage = mime.startsWith('image/') && mime !== 'image/svg+xml';
    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');
    const options = {
      ...(quoted ? { quoted } : {}),
      mediaUploadTimeoutMs: isVideo || isAudio ? mediaUploadTimeoutMs() : undefined,
    };
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
          : isAudio
            ? {
                audio: fs.createReadStream(file.path),
                fileName: file.filename,
                mimetype: file.mimetype || 'audio/mpeg',
                ptt: Boolean(file.ptt),
              }
            : {
                document: fs.readFileSync(file.path),
                fileName: file.filename,
                mimetype: file.mimetype || 'text/plain',
              };
      await sock.sendMessage(jid, payload, options);
      logger.info({ jid, filename: file.filename, mime }, 'sent generated file');
    } catch (error) {
      if (isVideo || isAudio) {
        try {
          await sock.sendMessage(jid, {
            document: fs.createReadStream(file.path),
            fileName: file.filename,
            mimetype: file.mimetype || (isAudio ? 'audio/mpeg' : 'video/mp4'),
          }, { ...options, mediaUploadTimeoutMs: mediaUploadTimeoutMs() });
          logger.info({ jid, filename: file.filename }, 'sent media as document after send failed');
          continue;
        } catch (docError) {
          logger.error({ err: docError, jid, filename: file.filename }, 'failed to send media document fallback');
        }
      }
      logger.error({ err: error, jid, filename: file.filename }, 'failed to send generated file');
    } finally {
      if (isVideo || isAudio) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // temp file already gone
        }
      }
    }
  }
}
