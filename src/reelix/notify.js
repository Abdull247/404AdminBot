import sharp from 'sharp';
import { logger } from '../utils/logger.js';
import { getConnectionStatus, getCurrentSocket } from '../whatsapp/socket.js';
import {
  reelixChannelEnabled,
  reelixChannelJid,
  reelixGroupEnabled,
  reelixGroupJid,
  reelixSendDestinations,
} from '../whatsapp/reelix-gate.js';

const MAX_ITEMS = 20;
const COVER_FETCH_TIMEOUT_MS = 15000;
const COVER_MAX_BYTES = 8 * 1024 * 1024;

export function kindLabel(kind, count = 1) {
  const value = String(kind || '').toLowerCase();
  if (value === 'series') return 'series';
  return count === 1 ? 'movie' : 'movies';
}

function itemCoverUrl(item) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.coverUrl === 'string' && item.coverUrl.trim()) return item.coverUrl.trim();
  if (item.cover && typeof item.cover.url === 'string') return item.cover.url.trim();
  if (typeof item.image === 'string' && item.image.trim()) return item.image.trim();
  if (typeof item.poster === 'string' && item.poster.trim()) return item.poster.trim();
  return '';
}

function itemTitle(item) {
  return String(item?.title || item?.name || '').trim();
}

function itemId(item) {
  return String(item?.subjectId || item?.id || '').trim();
}

function formatDetailLine(item) {
  const bits = [];
  const year = String(item.releaseDate || item.year || '').trim().slice(0, 4);
  if (year) bits.push(year);
  if (item.genre) bits.push(String(item.genre).trim());
  if (item.imdbRating) bits.push(`IMDb ${String(item.imdbRating).trim()}`);
  if (item.countryName) bits.push(String(item.countryName).trim());
  if (item.seNum && Number(item.seNum) > 0) bits.push(`${item.seNum} season${Number(item.seNum) === 1 ? '' : 's'}`);
  return bits.filter(Boolean).join(' · ');
}

export function composeItemCaption(item, { kind, index, total } = {}) {
  const title = itemTitle(item);
  const details = formatDetailLine(item);
  const description = String(item.description || '').trim();
  const label = kindLabel(kind, 1);
  const heading = total > 1
    ? `New on Reelix (${index + 1}/${total})`
    : `New ${label} on Reelix`;
  const lines = [heading, ''];
  if (title) lines.push(`*${title}*`);
  if (details) lines.push(details);
  if (description) lines.push(description.slice(0, 400));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n').trim() || heading;
}

export function composeNotifyCaption({ kind, newCount, items = [], text = '' } = {}) {
  const custom = String(text || '').trim();
  if (custom) return custom;

  const list = Array.isArray(items) ? items.slice(0, MAX_ITEMS) : [];
  const count = Number.isFinite(Number(newCount)) && Number(newCount) > 0
    ? Number(newCount)
    : list.length;
  const label = kindLabel(kind, count);
  const heading = count === 1
    ? `New ${label} on Reelix`
    : `${count} new ${label} on Reelix`;

  const lines = [heading, ''];
  for (const item of list) {
    const title = itemTitle(item);
    if (!title) continue;
    const details = formatDetailLine(item);
    const description = String(item.description || '').trim();
    lines.push(`*${title}*`);
    if (details) lines.push(details);
    if (description) lines.push(description.slice(0, 280));
    lines.push('');
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join('\n').trim() || heading;
}

export function normalizeNotifyPayload(body = {}) {
  const items = Array.isArray(body.items)
    ? body.items.filter((item) => item && typeof item === 'object').slice(0, MAX_ITEMS)
    : [];
  const kind = String(body.kind || (items[0]?.kind) || 'movie').toLowerCase() === 'series'
    ? 'series'
    : 'movie';
  const text = String(body.text || body.caption || body.message || '').trim();
  const coverUrl = String(body.coverUrl || body.image || itemCoverUrl(items[0]) || '').trim();
  const jid = String(body.jid || body.to || '').trim();
  const newCount = Number.isFinite(Number(body.newCount)) && Number(body.newCount) > 0
    ? Number(body.newCount)
    : items.length;
  return {
    kind,
    newCount,
    items,
    text,
    coverUrl,
    jid,
    caption: composeNotifyCaption({ kind, newCount, items, text }),
  };
}

async function fetchCoverBuffer(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, 'reelix cover fetch failed');
      return null;
    }
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length || buffer.length > COVER_MAX_BYTES) return null;
    return toJpegCover(buffer, mime.startsWith('image/') ? mime : 'image/jpeg');
  } catch (error) {
    logger.warn({ err: error, url }, 'reelix cover fetch error');
    return null;
  }
}

async function toJpegCover(buffer, mimetype) {
  try {
    const jpeg = await sharp(buffer).rotate().jpeg({ quality: 85 }).toBuffer();
    if (jpeg.length && jpeg.length <= COVER_MAX_BYTES) {
      return { buffer: jpeg, mimetype: 'image/jpeg' };
    }
  } catch (error) {
    logger.warn({ err: error, mimetype }, 'reelix cover jpeg convert failed');
  }
  return {
    buffer,
    mimetype: mimetype.startsWith('image/') ? mimetype : 'image/jpeg',
  };
}

async function sendOne(sock, jid, { caption, coverUrl }) {
  const cover = coverUrl ? await fetchCoverBuffer(coverUrl) : null;
  if (cover) {
    await sock.sendMessage(jid, {
      image: cover.buffer,
      mimetype: cover.mimetype,
      caption,
    });
    return true;
  }
  await sock.sendMessage(jid, { text: caption });
  return false;
}

function missingDestinationError(payload) {
  const reasons = [];
  if (!reelixGroupEnabled() && !reelixChannelEnabled() && !payload.jid) {
    return 'Reelix group and channel sends are disabled';
  }
  if (reelixGroupEnabled() && !reelixGroupJid()) reasons.push('REELIX_GROUP_JID is not set');
  if (reelixChannelEnabled() && !reelixChannelJid()) {
    reasons.push('REELIX_CHANNEL_JID is not set and the channel invite could not be resolved');
  }
  if (!reasons.length && !payload.jid) reasons.push('no Reelix send destinations');
  return reasons.join('; ');
}

async function sendPayloadToJid(sock, jid, payload) {
  let sent = 0;
  let withImage = 0;
  if (payload.items.length) {
    for (let index = 0; index < payload.items.length; index += 1) {
      const item = payload.items[index];
      const caption = payload.text && payload.items.length === 1
        ? payload.text
        : composeItemCaption(item, { kind: payload.kind, index, total: payload.items.length });
      const usedImage = await sendOne(sock, jid, {
        caption,
        coverUrl: itemCoverUrl(item) || (index === 0 ? payload.coverUrl : ''),
      });
      sent += 1;
      if (usedImage) withImage += 1;
    }
  } else {
    const usedImage = await sendOne(sock, jid, {
      caption: payload.caption,
      coverUrl: payload.coverUrl,
    });
    sent = 1;
    if (usedImage) withImage = 1;
  }
  return { sent, withImage };
}

export async function sendReelixGroupMessage(raw = {}) {
  const payload = normalizeNotifyPayload(raw);
  const sock = getCurrentSocket();
  const status = getConnectionStatus();
  if (!sock || status !== 'open') {
    return { ok: false, error: `whatsapp is not connected (${status})`, status: 503, whatsapp: status };
  }

  const destinations = await reelixSendDestinations(sock, payload.jid);
  if (!destinations.length) {
    return { ok: false, error: missingDestinationError(payload), status: 503 };
  }

  const results = [];
  let sent = 0;
  let withImage = 0;
  let lastError = '';

  for (const destination of destinations) {
    try {
      const result = await sendPayloadToJid(sock, destination.jid, payload);
      sent += result.sent;
      withImage += result.withImage;
      results.push({
        ok: true,
        type: destination.type,
        jid: destination.jid,
        messages: result.sent,
        image: result.withImage > 0,
      });
      logger.info(
        {
          jid: destination.jid,
          type: destination.type,
          kind: payload.kind,
          newCount: payload.newCount,
          items: payload.items.length,
          sent: result.sent,
          image: result.withImage,
        },
        'sent reelix message',
      );
    } catch (error) {
      lastError = error.message || 'send failed';
      logger.error({ err: error, jid: destination.jid, type: destination.type }, 'failed to send reelix message');
      results.push({
        ok: false,
        type: destination.type,
        jid: destination.jid,
        error: lastError,
      });
    }
  }

  const ok = results.some((item) => item.ok);
  if (!ok) {
    return {
      ok: false,
      error: lastError || 'send failed',
      status: 502,
      sent,
      destinations: results,
    };
  }

  return {
    ok: true,
    sent: true,
    jid: results.find((item) => item.ok)?.jid || destinations[0].jid,
    destinations: results,
    kind: payload.kind,
    newCount: payload.newCount,
    messages: sent,
    image: withImage > 0,
    items: payload.items.map((item) => ({
      subjectId: itemId(item),
      title: itemTitle(item),
      ...(itemCoverUrl(item) ? { coverUrl: itemCoverUrl(item) } : {}),
    })),
  };
}
