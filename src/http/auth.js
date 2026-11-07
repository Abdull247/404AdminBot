import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function sendKeyConfigured() {
  return Boolean(env.REELIX_SEND_KEY);
}

function providedKey(req) {
  const header = req.headers['x-reelix-send-key'] || req.headers['x-admin-key'] || '';
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = auth.match(/^(?:Bearer|Admin)\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

function keysMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function authorizeSend(req) {
  if (!sendKeyConfigured()) {
    return { ok: false, status: 503, error: 'REELIX_SEND_KEY is not set' };
  }
  const provided = providedKey(req);
  if (!provided) {
    return { ok: false, status: 401, error: 'X-Reelix-Send-Key is required' };
  }
  if (!keysMatch(provided, env.REELIX_SEND_KEY)) {
    return { ok: false, status: 401, error: 'invalid send key' };
  }
  return { ok: true };
}

export async function readJsonBody(req, { limit = 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('payload too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('invalid JSON body');
    error.status = 400;
    throw error;
  }
}
