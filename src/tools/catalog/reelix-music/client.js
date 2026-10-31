import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../../config/env.js';

const HMAC_VERSION = 'v1';
const DEFAULT_AUDIO_USER_AGENT = 'ReelixMusic/1.0 (Android)';

const AUDIO_MIME_EXT = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function reelixMusicConfigured() {
  return Boolean(env.REELIX_MUSIC_PROXY_BASE_URL && env.REELIX_MUSIC_BOT_KEY && env.REELIX_MUSIC_BOT_HMAC_SECRET);
}

function pathnameOf(urlPath) {
  const next = String(urlPath || '/').split('?')[0];
  return next || '/';
}

function canonicalBot({ key, method, path, timestamp, nonce }) {
  return [
    HMAC_VERSION,
    'bot',
    String(key || ''),
    String(method || 'GET').toUpperCase(),
    pathnameOf(path),
    String(timestamp),
    nonce,
  ].join('\n');
}

export function musicBotHeaders({
  method = 'GET',
  path,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = crypto.randomBytes(16).toString('hex'),
} = {}) {
  const key = env.REELIX_MUSIC_BOT_KEY;
  const secret = env.REELIX_MUSIC_BOT_HMAC_SECRET;
  const payload = canonicalBot({ key, method, path, timestamp, nonce });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'x-bot-key': key,
    'x-bot-timestamp': String(timestamp),
    'x-bot-nonce': nonce,
    'x-bot-signature': signature,
  };
}

function joinUrl(base, nextPath) {
  const root = trimSlash(base);
  const next = String(nextPath || '');
  if (!next) return root;
  return next.startsWith('/') ? `${root}${next}` : `${root}/${next}`;
}

export async function reelixMusicRequest({
  method = 'GET',
  path,
  query,
  timeoutMs = env.REELIX_MUSIC_BOT_TIMEOUT_MS,
} = {}) {
  if (!reelixMusicConfigured()) {
    return {
      ok: false,
      error: 'Reelix music proxy is not configured (set REELIX_MUSIC_PROXY_BASE_URL, REELIX_MUSIC_BOT_KEY, REELIX_MUSIC_BOT_HMAC_SECRET)',
    };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  const urlPath = qs ? `${path}?${qs}` : path;
  const url = joinUrl(env.REELIX_MUSIC_PROXY_BASE_URL, urlPath);
  const headers = {
    ...musicBotHeaders({ method, path }),
    accept: 'application/json',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    const response = await fetch(url, { method, headers, signal: controller.signal });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: json?.message || json?.error || `Reelix music proxy request failed with status ${response.status}`,
        code: json?.error || null,
      };
    }
    return { ok: true, status: response.status, data: json };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, error: 'Reelix music proxy request timed out' };
    }
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadBuffer(url, timeoutMs = env.REELIX_MUSIC_BOT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim();
    return { buffer, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function audioExtension(contentType, url) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const fromMime = AUDIO_MIME_EXT[mime];
  if (fromMime) return fromMime;
  const match = String(url || '').match(/\.([a-z0-9]{2,4})(?:$|[?#])/i);
  if (match) return match[1].toLowerCase();
  return 'mp3';
}

function safeJid(jid) {
  return String(jid || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function downloadReelixAudio(url, { jid = '', title = '' } = {}) {
  const maxMb = env.REELIX_MUSIC_AUDIO_MAX_MB || 50;
  const maxBytes = Math.max(1, maxMb) * 1024 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.REELIX_MUSIC_AUDIO_TIMEOUT_MS || 180000);
  const headers = {
    'user-agent': env.REELIX_VIDEO_USER_AGENT || DEFAULT_AUDIO_USER_AGENT,
    accept: 'audio/mpeg,audio/mp4,audio/*;q=0.9,*/*;q=0.8',
  };
  if (env.REELIX_VIDEO_REFERER) headers.referer = env.REELIX_VIDEO_REFERER;

  let response;
  try {
    response = await fetch(url, { signal: controller.signal, headers, redirect: 'follow' });
  } catch (error) {
    return {
      ok: false,
      error: error.name === 'AbortError'
        ? 'audio download timed out'
        : `audio download failed: ${error.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok || !response.body) {
    return { ok: false, error: `audio download failed with status ${response.status || 'no body'}` };
  }

  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > maxBytes) {
    return {
      ok: false,
      error: `audio is too large (${Math.round(declared / 1048576)}MB) to send in WhatsApp`,
    };
  }

  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim() || 'audio/mpeg';
  const dir = path.join(env.TOOLS_OUTPUT_DIR, safeJid(jid), 'reelix-music');
  fs.mkdirSync(dir, { recursive: true });
  const ext = audioExtension(contentType, url);
  const filename = `reelix-audio-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const filePath = path.join(dir, filename);

  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, callback) {
      size += chunk.length;
      if (size > maxBytes) {
        callback(new Error(`audio exceeds the ${maxMb}MB send limit`));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(filePath, { flags: 'w' }));
  } catch (error) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return {
      ok: false,
      error: error.name === 'AbortError'
        ? 'audio download timed out'
        : `audio download failed: ${error.message}`,
    };
  }

  let written = 0;
  try {
    written = fs.statSync(filePath).size;
  } catch {
    written = 0;
  }
  if (!size || !written) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return { ok: false, error: 'audio download returned an empty file' };
  }

  const mime = ext === 'mp3' ? 'audio/mpeg' : (contentType.startsWith('audio/') ? contentType : 'audio/mpeg');
  return {
    ok: true,
    filePath,
    filename,
    contentType: mime,
    size: written || size,
    title,
  };
}
