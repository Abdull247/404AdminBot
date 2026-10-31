import crypto from 'node:crypto';
import { env } from '../../../config/env.js';

const HMAC_VERSION = 'v1';
const NONCE_MIN_LEN = 16;

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function reelixConfigured() {
  return Boolean(env.REELIX_PROXY_BASE_URL && env.REELIX_BOT_KEY && env.REELIX_BOT_HMAC_SECRET);
}

function pathnameOf(urlPath) {
  const path = String(urlPath || '/').split('?')[0];
  return path || '/';
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

export function botHeaders({
  method = 'GET',
  path,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = crypto.randomBytes(16).toString('hex'),
} = {}) {
  const key = env.REELIX_BOT_KEY;
  const secret = env.REELIX_BOT_HMAC_SECRET;
  const payload = canonicalBot({ key, method, path, timestamp, nonce });
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return {
    'x-bot-key': key,
    'x-bot-timestamp': String(timestamp),
    'x-bot-nonce': nonce,
    'x-bot-signature': signature,
  };
}

function joinUrl(base, path) {
  const root = trimSlash(base);
  const next = String(path || '');
  if (!next) return root;
  return next.startsWith('/') ? `${root}${next}` : `${root}/${next}`;
}

export async function reelixRequest({
  method = 'GET',
  path,
  query,
  body,
  timeoutMs = env.REELIX_BOT_TIMEOUT_MS,
} = {}) {
  if (!reelixConfigured()) {
    return { ok: false, error: 'Reelix proxy is not configured (set REELIX_PROXY_BASE_URL, REELIX_BOT_KEY, REELIX_BOT_HMAC_SECRET)' };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  const urlPath = qs ? `${path}?${qs}` : path;
  const url = joinUrl(env.REELIX_PROXY_BASE_URL, urlPath);
  const headers = {
    ...botHeaders({ method, path }),
    accept: 'application/json',
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: json?.message || json?.error || `Reelix proxy request failed with status ${response.status}`,
        code: json?.error || null,
      };
    }
    return { ok: true, status: response.status, data: json };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, error: 'Reelix proxy request timed out' };
    }
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadBuffer(url, timeoutMs = env.REELIX_BOT_TIMEOUT_MS) {
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
