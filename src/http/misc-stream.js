import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { defaultMusicSource, publicStreamEndpointEnabled } from '../tools/catalog/reelix-music/access.js';
import { reelixMusicConfigured, reelixMusicRequest } from '../tools/catalog/reelix-music/client.js';

const SOURCES = new Set(['youtube', 'spotify', 'audiomack']);

function queryOf(url) {
  const raw = String(url || '');
  const index = raw.indexOf('?');
  if (index === -1) return new URLSearchParams();
  return new URLSearchParams(raw.slice(index + 1));
}

function pickSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (SOURCES.has(source)) return source;
  return defaultMusicSource();
}

function streamUrlOf(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  return String(data.directUrl || data.url || '').trim();
}

export function publicStreamUrl({ trackId, source } = {}) {
  const base = env.BASE_URL;
  if (!base || !trackId) return '';
  const params = new URLSearchParams({ trackId: String(trackId) });
  if (source) params.set('source', String(source));
  return `${base}/misc/stream?${params}`;
}

export async function handleMiscStream(req, res) {
  if (!publicStreamEndpointEnabled()) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  if (!reelixMusicConfigured()) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Reelix music proxy is not configured' }));
    return;
  }

  const params = queryOf(req.url);
  const trackId = String(params.get('trackId') || params.get('id') || '').trim();
  if (!trackId) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'trackId is required' }));
    return;
  }
  const source = pickSource(params.get('source'));

  const result = await reelixMusicRequest({
    path: `/bot/api/tracks/${encodeURIComponent(trackId)}/streams`,
    query: { source, url: params.get('url') || '' },
  });
  if (!result.ok) {
    res.writeHead(result.status && result.status >= 400 ? result.status : 502, {
      'content-type': 'application/json; charset=utf-8',
    });
    res.end(JSON.stringify({ ok: false, error: result.error || 'stream lookup failed' }));
    return;
  }

  const audioUrl = streamUrlOf(result.data);
  if (!audioUrl) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'no playable audio URL' }));
    return;
  }

  if (params.get('json') === '1' || params.get('format') === 'json') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({
      ok: true,
      trackId,
      source: result.data?.source || source,
      url: audioUrl,
    }));
    return;
  }

  res.writeHead(302, {
    location: audioUrl,
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end();
}

export function logMiscStreamError(error) {
  logger.error({ err: error }, 'misc stream failed');
}
