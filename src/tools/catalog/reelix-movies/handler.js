import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env } from '../../../config/env.js';
import { upsertMemory } from '../../../db/repositories/memories.js';
import { logger } from '../../../utils/logger.js';
import { downloadBuffer, downloadReelixVideo, reelixConfigured, reelixRequest } from './client.js';
import { canAccessReelixDownload, DOWNLOAD_ALLOWED_NOTICE } from './access.js';
import {
  detailsCaption,
  summarizeCast,
  summarizeDetails,
  summarizeDownload,
  summarizeResources,
  summarizeSearch,
  summarizeSeasons,
} from './format.js';

const ACTIONS = new Set(['search', 'details', 'resources', 'cast', 'seasons', 'download']);

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

function cleanSubjectId(value) {
  const id = String(value || '').trim();
  if (!/^\d+$/.test(id)) throw new Error('subjectId must be a numeric id from search or details');
  return id;
}

function clampCount(value, fallback) {
  const count = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(count)) return fallback;
  return Math.min(20, Math.max(1, count));
}

async function saveBanner(url, context, caption) {
  if (!url) return [];
  const downloaded = await downloadBuffer(url);
  if (!downloaded?.buffer?.length) return [];
  const ext = extensionFor(downloaded.contentType);
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const filename = `reelix-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const dir = path.join(env.TOOLS_OUTPUT_DIR, safeJid(context.jid), 'reelix');
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
  const page = clampCount(args.page, 1);
  const perPage = clampCount(args.count || args.perPage, 8);
  const result = await reelixRequest({
    path: '/bot/api/search',
    query: { keyword, page, perPage },
  });
  if (!result.ok) return result;
  const summary = summarizeSearch(result.data);
  return {
    ok: true,
    action: 'search',
    ...summary,
    hint: summary.results.length
      ? 'Pick a title and call details with its subjectId for the full page (banner + recap).'
      : 'No titles matched. Try a shorter or alternate title.',
  };
}

async function handleDetails(args, context) {
  const subjectId = cleanSubjectId(args.subjectId);
  const result = await reelixRequest({
    path: `/bot/api/subjects/${subjectId}`,
  });
  if (!result.ok) return result;
  const info = summarizeDetails(result.data, subjectId);
  const files = await saveBanner(info.bannerUrl || info.posterUrl, context, info.title || detailsCaption(info));
  return {
    ok: true,
    action: 'details',
    ...info,
    bannerSent: files.length > 0,
    files,
    hint: 'The banner is sent as an image when available. Reply with the title, type, rating, genre, and a short recap from description. Call cast or resources if the user wants those.',
  };
}

async function handleResources(args) {
  const subjectId = cleanSubjectId(args.subjectId);
  const result = await reelixRequest({
    path: `/bot/api/subjects/${subjectId}/resources`,
    query: {
      page: clampCount(args.page, 1),
      perPage: clampCount(args.perPage, 20),
      se: args.season,
    },
  });
  if (!result.ok) return result;
  return {
    ok: true,
    action: 'resources',
    ...summarizeResources(result.data),
    hint: 'Summarize availability, quality, and episode coverage. Do not invent playback links. Do not mention download URLs.',
  };
}

function downloadDenied() {
  return {
    ok: false,
    action: 'download',
    error: 'Download links are not available in this chat.',
  };
}

async function handleDownload(args, context) {
  if (!canAccessReelixDownload(context)) return downloadDenied();
  const subjectId = cleanSubjectId(args.subjectId);
  const result = await reelixRequest({
    path: `/bot/api/subjects/${subjectId}/resources`,
    query: {
      page: clampCount(args.page, 1),
      perPage: clampCount(args.perPage, 20),
      se: args.season,
      resolution: args.resolution,
    },
  });
  if (!result.ok) return result;
  const summary = summarizeDownload(result.data, {
    resourceId: args.resourceId,
    quality: args.quality,
    resolution: args.resolution,
  });
  if (!summary.items.length) {
    return {
      ok: false,
      action: 'download',
      error: 'No matching download URL came back for that title or quality.',
      subjectId,
      title: summary.title,
      total: summary.total,
    };
  }
  const picked = summary.items[0];
  const base = {
    ok: true,
    action: 'download',
    allowed: true,
    notice: DOWNLOAD_ALLOWED_NOTICE,
    subjectId: summary.subjectId,
    title: summary.title,
    url: picked.url,
    quality: picked.quality,
    resolution: picked.resolution,
    resourceId: picked.resourceId,
    size: picked.size,
    season: picked.season,
    episode: picked.episode,
    items: summary.items.slice(0, 8),
    files: [],
  };

  if (args.rememberVideoPreference) {
    try {
      await upsertMemory({
        jid: context.jid,
        key: 'reelix:send_video',
        value: 'true',
        importance: 5,
        metadata: {
          subjectId,
          title: summary.title,
          resourceId: picked.resourceId,
          savedAt: new Date().toISOString(),
        },
      });
      base.preferenceSaved = true;
    } catch (error) {
      logger.warn({ err: error, jid: context.jid }, 'failed to save Reelix video preference');
    }
  }

  if (args.sendVideo) {
    const file = await downloadReelixVideo(picked.url, {
      jid: context.jid,
      title: summary.title,
      cookie: picked.signCookie || '',
    });
    if (file.ok) {
      return {
        ...base,
        sentAsVideo: true,
        videoFile: { filename: file.filename, size: file.size },
        files: [{
          ok: true,
          filename: file.filename,
          path: file.filePath,
          mimetype: file.contentType,
          size: file.size,
          attachment: true,
          caption: summary.title || file.filename,
        }],
        hint: base.preferenceSaved
          ? 'The mp4 has been attached and will be sent directly. The user preference to always receive Reelix videos as mp4 has been saved. Keep the reply short.'
          : 'The mp4 has been attached and will be sent directly to the user in WhatsApp. Keep the reply short.',
      };
    }
    return {
      ...base,
      sentAsVideo: false,
      videoError: file.error,
      hint: `The video file could not be sent (${file.error}). Share the direct URL instead and tell the user.`,
    };
  }

  return {
    ...base,
    hint: 'Share only the direct download URL by default, then ask whether the user wants it sent as a video mp4 file. If they say yes, call download again with sendVideo=true. If they want it always sent as mp4, call with sendVideo=true and rememberVideoPreference=true.',
  };
}

async function handleCast(args) {
  const subjectId = cleanSubjectId(args.subjectId);
  const type = String(args.type || args.mediaType || '').toLowerCase();
  const asSeries = type === 'series' || type === 'tv' || type === '2';
  const pathName = asSeries
    ? `/bot/api/cast/tv/${subjectId}`
    : `/bot/api/cast/movie/${subjectId}`;
  let result = await reelixRequest({ path: pathName });
  if (!result.ok && !type) {
    const fallback = asSeries
      ? `/bot/api/cast/movie/${subjectId}`
      : `/bot/api/cast/tv/${subjectId}`;
    result = await reelixRequest({ path: fallback });
  }
  if (!result.ok) return result;
  return {
    ok: true,
    action: 'cast',
    ...summarizeCast(result.data),
  };
}

async function handleSeasons(args) {
  const subjectId = cleanSubjectId(args.subjectId);
  const result = await reelixRequest({
    path: `/bot/api/subjects/${subjectId}/seasons`,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    action: 'seasons',
    ...summarizeSeasons(result.data),
  };
}

export async function handler(args = {}, context = {}) {
  if (!reelixConfigured()) {
    return {
      ok: false,
      error: 'Reelix proxy is not configured (set REELIX_PROXY_BASE_URL, REELIX_BOT_KEY, REELIX_BOT_HMAC_SECRET)',
    };
  }

  const action = String(args.action || 'search').trim().toLowerCase();
  if (!ACTIONS.has(action)) {
    return { ok: false, error: `unknown action "${action}". Use search, details, resources, cast, seasons, or download.` };
  }

  try {
    if (action === 'search') return await handleSearch(args);
    if (action === 'details') return await handleDetails(args, context);
    if (action === 'resources') return await handleResources(args);
    if (action === 'download') return await handleDownload(args, context);
    if (action === 'cast') return await handleCast(args);
    if (action === 'seasons') return await handleSeasons(args);
    return { ok: false, error: `unknown action "${action}"` };
  } catch (error) {
    logger.error({ err: error, action }, 'reelix_movies failed');
    return { ok: false, error: error.message };
  }
}
