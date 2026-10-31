import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { downloadBuffer, downloadReelixAudio, reelixMusicConfigured, reelixMusicRequest } from './client.js';
import { canAccessReelixMusicStream, defaultMusicSource } from './access.js';
import { publicStreamUrl } from '../../../http/misc-stream.js';
import { detailsCaption, summarizeDetails, summarizeSearch, summarizeStream } from './format.js';

const ACTIONS = new Set(['search', 'details', 'stream']);
const SOURCES = new Set(['youtube', 'spotify', 'audiomack']);

function extensionFor(contentType) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return map[String(contentType || '').split(';')[0].trim()] || 'jpg';
}

function safeJid(jid) {
  return String(jid || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function cleanKeyword(value) {
  const keyword = String(value || '').trim();
  if (!keyword) throw new Error('query is required');
  return keyword.slice(0, 200);
}

function cleanTrackId(value) {
  const id = String(value || '').trim();
  if (!id) throw new Error('trackId is required');
  if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(id)) throw new Error('trackId is invalid');
  return id;
}

function cleanSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!source) return defaultMusicSource();
  if (!SOURCES.has(source)) throw new Error('source must be youtube, spotify, or audiomack');
  return source;
}

function clampCount(value, fallback) {
  const count = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(count)) return fallback;
  return Math.min(20, Math.max(1, count));
}

function sanitizeFilename(value) {
  return String(value || 'track')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'track';
}

async function saveCover(url, context, caption) {
  if (!url) return [];
  const downloaded = await downloadBuffer(url);
  if (!downloaded?.buffer?.length) return [];
  const ext = extensionFor(downloaded.contentType);
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const filename = `reelix-music-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const dir = path.join(env.TOOLS_OUTPUT_DIR, safeJid(context.jid), 'reelix-music');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, downloaded.buffer);
  return [{
    ok: true,
    filename,
    path: filePath,
    mimetype: mime,
    size: downloaded.buffer.length,
    attachment: true,
    caption: caption || filename,
  }];
}

async function handleSearch(args) {
  const keyword = cleanKeyword(args.query || args.keyword);
  const source = cleanSource(args.source);
  const result = await reelixMusicRequest({
    path: '/bot/api/search',
    query: {
      keyword,
      source,
      type: args.type || 'song',
      page: clampCount(args.page, 1),
      perPage: clampCount(args.count || args.perPage, 8),
    },
  });
  if (!result.ok) return result;
  const summary = summarizeSearch(result.data);
  return {
    ok: true,
    action: 'search',
    ...summary,
    hint: summary.results.length
      ? 'Pick a track and call details with its trackId (and the same source) for cover art. Then stream to send the mp3.'
      : 'No tracks matched. Try a shorter query or another source (youtube, spotify, audiomack).',
  };
}

async function handleDetails(args, context) {
  const trackId = cleanTrackId(args.trackId);
  const source = cleanSource(args.source);
  const result = await reelixMusicRequest({
    path: `/bot/api/tracks/${encodeURIComponent(trackId)}`,
    query: { source },
  });
  if (!result.ok) return result;
  const info = summarizeDetails(result.data, trackId);
  const files = await saveCover(info.thumbnail, context, detailsCaption(info));
  return {
    ok: true,
    action: 'details',
    ...info,
    coverSent: files.length > 0,
    files,
    hint: 'The cover is sent as an image when available. Reply with title and artist. Call stream with this trackId to send the mp3.',
  };
}

function streamDenied() {
  return {
    ok: false,
    action: 'stream',
    error: 'Streaming this track is not available in this chat.',
  };
}

async function handleStream(args, context) {
  if (!canAccessReelixMusicStream(context)) return streamDenied();
  const trackId = cleanTrackId(args.trackId);
  const source = cleanSource(args.source);
  const result = await reelixMusicRequest({
    path: `/bot/api/tracks/${encodeURIComponent(trackId)}/streams`,
    query: { source, url: args.url },
  });
  if (!result.ok) return result;
  const summary = summarizeStream(result.data, {
    trackId,
    source,
    title: args.title,
    artist: args.artist,
  });
  if (!summary.url) {
    return {
      ok: false,
      action: 'stream',
      error: 'No playable audio URL came back for that track.',
      trackId,
      source,
    };
  }

  const file = await downloadReelixAudio(summary.url, {
    jid: context.jid,
    title: summary.title,
  });
  if (!file.ok) {
    return {
      ok: false,
      action: 'stream',
      error: file.error,
      trackId,
      source,
    };
  }

  const display = sanitizeFilename([summary.artist, summary.title].filter(Boolean).join(' - ') || 'track');
  const ext = String(file.filename).split('.').pop() || 'mp3';
  const filename = `${display}.${ext}`;
  const publicUrl = publicStreamUrl({ trackId, source: summary.source || source });
  return {
    ok: true,
    action: 'stream',
    trackId,
    title: summary.title,
    artist: summary.artist,
    source: summary.source,
    sentAs: 'audio',
    publicUrl: publicUrl || undefined,
    files: [{
      ok: true,
      filename,
      path: file.filePath,
      mimetype: file.contentType || 'audio/mpeg',
      size: file.size,
      attachment: true,
      caption: summary.title || filename,
      ptt: false,
    }],
    hint: 'The track is sent as an mp3 audio file. Recap the title and artist. Do not share the stream URL.',
  };
}

export async function handler(args = {}, context = {}) {
  if (!reelixMusicConfigured()) {
    return {
      ok: false,
      error: 'Reelix music proxy is not configured (set REELIX_MUSIC_PROXY_BASE_URL, REELIX_MUSIC_BOT_KEY, REELIX_MUSIC_BOT_HMAC_SECRET)',
    };
  }

  const action = String(args.action || 'search').trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return { ok: false, error: `unknown action "${action}". Use search, details, or stream.` };
  }

  try {
    if (action === 'search') return await handleSearch(args);
    if (action === 'details') return await handleDetails(args, context);
    if (action === 'stream') return await handleStream(args, context);
    return { ok: false, error: `unknown action "${action}"` };
  } catch (error) {
    logger.error({ err: error, action }, 'reelix_music failed');
    return { ok: false, error: error.message };
  }
}
