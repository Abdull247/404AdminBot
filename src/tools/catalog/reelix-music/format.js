function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function artistNameOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => artistNameOf(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return firstString(value.name, value.title, value.artist);
  }
  return '';
}

export function coverUrlOf(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = coverUrlOf(item);
      if (found) return found;
    }
    return '';
  }
  return firstString(
    value.url,
    value.src,
    value.thumbnail,
    value.cover,
    value.poster,
    coverUrlOf(value.images),
    coverUrlOf(value.artwork),
  );
}

export function summarizeTrack(item = {}, extra = {}) {
  const artists = artistNameOf(item.artists) || artistNameOf(item.artist);
  const thumbnail = coverUrlOf(item.thumbnail) || coverUrlOf(item.cover) || coverUrlOf(item.artwork);
  return {
    trackId: firstString(item.trackId, item.id, item.videoId, extra.trackId),
    title: firstString(item.title, item.name),
    artist: artists,
    album: firstString(item.album?.title, item.album?.name, typeof item.album === 'string' ? item.album : ''),
    duration: Number(item.duration) || 0,
    durationText: firstString(item.durationText),
    type: firstString(item.type, 'song'),
    source: firstString(item.source, extra.source),
    thumbnail,
    url: firstString(item.url),
  };
}

export function summarizeSearch(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    keyword: payload.keyword || '',
    page: payload.page || 1,
    perPage: payload.perPage || items.length,
    total: payload.total || items.length,
    source: payload.source || '',
    results: items.map((item) => summarizeTrack(item, { source: payload.source })).filter((item) => item.trackId || item.title),
  };
}

export function summarizeDetails(payload = {}, trackId = '') {
  const track = payload.track && typeof payload.track === 'object' ? payload.track : payload;
  return summarizeTrack(track, { trackId: trackId || payload.trackId, source: payload.source });
}

export function detailsCaption(info = {}) {
  const bits = [info.artist, info.album, info.durationText, info.source].filter(Boolean);
  const title = info.title || 'Track';
  return bits.length ? `*${title}*\n${bits.join(' · ')}` : `*${title}*`;
}

export function summarizeStream(payload = {}, extra = {}) {
  const data = payload && typeof payload === 'object' ? payload : {};
  return {
    trackId: firstString(data.trackId, extra.trackId),
    title: firstString(extra.title, data.title),
    artist: firstString(extra.artist),
    source: firstString(data.source, extra.source),
    url: firstString(data.directUrl, data.url),
    type: firstString(data.type, 'audio'),
  };
}
