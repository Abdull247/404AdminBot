import fs from 'node:fs';
import { logger } from '../utils/logger.js';

const MEDIA_UPLOAD_TIMEOUT_MS = 300000;

function mediaUploadTimeoutMs() {
  return MEDIA_UPLOAD_TIMEOUT_MS;
}

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
    logger.warn({ err: error, filePath }, 'failed to read media file');
    return null;
  }
}

function removeTemp(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // temp file already gone
  }
}

export async function sendArtifacts(sock, jid, artifacts = [], quoted) {
  for (const file of artifacts) {
    if (!file?.ok || !file.path || !fileExists(file.path)) {
      if (file?.path) {
        logger.warn({ jid, filename: file.filename, path: file.path }, 'skipping missing generated file');
      }
      continue;
    }
    const mime = String(file.mimetype || '').toLowerCase();
    const isImage = mime.startsWith('image/') && mime !== 'image/svg+xml';
    const isVideo = mime.startsWith('video/');
    const isAudio = mime.startsWith('audio/');
    const options = {
      ...(quoted ? { quoted } : {}),
      mediaUploadTimeoutMs: isVideo || isAudio ? mediaUploadTimeoutMs() : undefined,
    };

    try {
      if (isImage) {
        const buffer = readMedia(file.path);
        if (!buffer) continue;
        await sock.sendMessage(jid, {
          image: buffer,
          fileName: file.filename,
          mimetype: file.mimetype,
          caption: file.caption || file.filename,
        }, options);
      } else if (isVideo) {
        if (!fileExists(file.path)) continue;
        await sock.sendMessage(jid, {
          video: { url: file.path },
          fileName: file.filename,
          mimetype: file.mimetype || 'video/mp4',
          caption: file.caption || file.filename,
        }, options);
      } else if (isAudio) {
        const buffer = readMedia(file.path);
        if (!buffer) continue;
        await sock.sendMessage(jid, {
          audio: buffer,
          mimetype: file.mimetype || 'audio/mpeg',
          ptt: Boolean(file.ptt),
        }, options);
      } else {
        const buffer = readMedia(file.path);
        if (!buffer) continue;
        await sock.sendMessage(jid, {
          document: buffer,
          fileName: file.filename,
          mimetype: file.mimetype || 'text/plain',
        }, options);
      }
      logger.info({ jid, filename: file.filename, mime }, 'sent generated file');
    } catch (error) {
      logger.error({ err: error, jid, filename: file.filename }, 'failed to send generated file');
      if ((isVideo || isAudio) && fileExists(file.path)) {
        try {
          const buffer = readMedia(file.path);
          if (!buffer) continue;
          await sock.sendMessage(jid, {
            document: buffer,
            fileName: file.filename,
            mimetype: file.mimetype || (isAudio ? 'audio/mpeg' : 'video/mp4'),
          }, { ...options, mediaUploadTimeoutMs: mediaUploadTimeoutMs() });
          logger.info({ jid, filename: file.filename }, 'sent media as document after send failed');
        } catch (docError) {
          logger.error({ err: docError, jid, filename: file.filename }, 'failed to send media document fallback');
        }
      }
    } finally {
      if (isVideo || isAudio) {
        removeTemp(file.path);
      }
    }
  }
}
