const TYPE_LABEL = {
  1: 'movie',
  2: 'series',
  3: 'anime',
};

export function mediaTypeOf(subject = {}) {
  const explicit = String(subject.mediaType || subject.media_type || '').toLowerCase();
  if (explicit === 'tv' || explicit === 'series') return 'series';
  if (explicit === 'movie' || explicit === 'anime') return explicit;
  const n = Number(subject.subjectType);
  return TYPE_LABEL[n] || 'movie';
}

export function coverUrlOf(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value.url || value.posterUrl || value.coverUrl || value.thumbnail || value.backdrop_url || '').trim();
}

export function bannerUrlOf(subject = {}) {
  const banner = coverUrlOf(subject.banner)
    || coverUrlOf(subject.backdrop)
    || coverUrlOf(subject.backdrop_url)
    || coverUrlOf(subject.image)
    || coverUrlOf(subject.cover)
    || coverUrlOf(subject.posterUrl)
    || coverUrlOf(subject.poster_url);
  return banner;
}

function ratingOf(subject = {}) {
  return String(
    subject.imdbRatingValue
    || subject.imdbRate
    || subject.imdbRating
    || subject.vote_average
    || subject.rate
    || '',
  ).trim();
}

export function summarizeSubject(subject = {}, extra = {}) {
  const subjectId = String(subject.subjectId || extra.subjectId || '').trim();
  const type = mediaTypeOf(subject);
  return {
    subjectId,
    title: String(subject.title || subject.name || '').trim(),
    type,
    subjectType: Number(subject.subjectType) || (type === 'series' ? 2 : 1),
    rating: ratingOf(subject),
    releaseDate: String(subject.releaseDate || subject.release_date || '').trim(),
    genre: String(subject.genre || '').trim(),
    country: String(subject.countryName || subject.country || '').trim(),
    description: String(subject.description || subject.overview || '').trim(),
    bannerUrl: bannerUrlOf(subject),
    posterUrl: coverUrlOf(subject.cover) || coverUrlOf(subject.posterUrl) || coverUrlOf(subject.poster_url),
    tmdbId: String(subject.tmdbId || '').trim(),
    hasResource: subject.hasResource !== false,
  };
}

export function summarizeSearch(payload = {}) {
  const subjects = Array.isArray(payload.subjects) ? payload.subjects : [];
  return {
    keyword: payload.keyword || '',
    page: payload.page || 1,
    perPage: payload.perPage || subjects.length,
    total: payload.total || subjects.length,
    results: subjects.map((item) => summarizeSubject(item)).filter((item) => item.subjectId || item.title),
  };
}

export function summarizeDetails(payload = {}, subjectId = '') {
  const subject = payload.subject && typeof payload.subject === 'object'
    ? payload.subject
    : payload;
  return summarizeSubject(subject, { subjectId: subjectId || payload.subjectId });
}

function resourceList(payload = {}) {
  const resources = payload.resources && typeof payload.resources === 'object' ? payload.resources : {};
  const list = Array.isArray(resources.list)
    ? resources.list
    : Array.isArray(resources.items)
      ? resources.items
      : [];
  return { resources, list };
}

function stripPlayUrl(item = {}) {
  return {
    title: item.title || item.name || '',
    season: item.season ?? item.se ?? null,
    episode: item.episode ?? item.ep ?? null,
    quality: item.quality || '',
    resolution: item.resolution || 0,
    size: item.size || '',
    sizeBytes: item.sizeBytes || 0,
    duration: item.duration || 0,
    resourceId: item.resourceId || item.streamId || '',
    signCookie: item.signCookie || item.sign_cookie || '',
  };
}

function downloadItem(item = {}) {
  return {
    title: item.title || item.name || '',
    season: item.season ?? item.se ?? null,
    episode: item.episode ?? item.ep ?? null,
    quality: item.quality || '',
    resolution: item.resolution || 0,
    size: item.size || '',
    sizeBytes: item.sizeBytes || 0,
    duration: item.duration || 0,
    resourceId: item.resourceId || item.streamId || '',
    url: item.url || item.resourceLink || '',
    signCookie: item.signCookie || item.sign_cookie || '',
  };
}

function qualityKey(value) {
  return String(value || '').trim().toLowerCase().replace(/p$/, '');
}

export function summarizeResources(payload = {}) {
  const { resources, list } = resourceList(payload);
  return {
    subjectId: payload.subjectId || resources.subjectId || '',
    title: resources.subjectTitle || '',
    type: mediaTypeOf({ subjectType: resources.subjectType }),
    genre: resources.genre || '',
    description: resources.description || '',
    releaseDate: resources.releaseDate || '',
    country: resources.countryName || '',
    totalEpisode: resources.totalEpisode || 0,
    bannerUrl: coverUrlOf(resources.cover) || coverUrlOf(resources.posterUrl),
    items: list.slice(0, 40).map(stripPlayUrl),
    total: list.length,
  };
}

export function summarizeDownload(payload = {}, filter = {}) {
  const { resources, list } = resourceList(payload);
  const items = list.map(downloadItem).filter((item) => item.url);
  const resourceId = String(filter.resourceId || '').trim();
  const quality = qualityKey(filter.quality);
  const resolution = Number.parseInt(filter.resolution, 10);

  let matched = items;
  if (resourceId) {
    matched = items.filter((item) => String(item.resourceId) === resourceId);
  } else if (Number.isFinite(resolution) && resolution > 0) {
    matched = items.filter((item) => Number(item.resolution) === resolution);
  } else if (quality) {
    matched = items.filter((item) => {
      const iq = qualityKey(item.quality);
      return iq === quality || String(item.resolution) === quality;
    });
  }

  return {
    subjectId: payload.subjectId || resources.subjectId || '',
    title: resources.subjectTitle || '',
    items: matched,
    total: items.length,
    matched: matched.length,
  };
}

export function summarizeCast(payload = {}) {
  const cast = Array.isArray(payload.cast) ? payload.cast : [];
  const crew = Array.isArray(payload.crew) ? payload.crew : [];
  return {
    subjectId: payload.subjectId || '',
    mediaType: payload.mediaType || '',
    castCount: payload.castCount ?? cast.length,
    crewCount: payload.crewCount ?? crew.length,
    cast: cast.slice(0, 20).map((person) => ({
      name: person.name || '',
      character: person.character || '',
    })),
    crew: crew.slice(0, 12).map((person) => ({
      name: person.name || '',
      job: person.job || person.department || '',
    })),
  };
}

export function summarizeSeasons(payload = {}) {
  const seasons = Array.isArray(payload.seasons) ? payload.seasons : [];
  return {
    subjectId: payload.subjectId || '',
    title: payload.title || '',
    bannerUrl: coverUrlOf(payload.cover) || coverUrlOf(payload.posterUrl),
    seasons: seasons.map((season) => ({
      season: season.season ?? season.seasonNumber ?? null,
      title: season.title || season.name || '',
      episodeCount: season.episodeCount ?? (Array.isArray(season.episodes) ? season.episodes.length : 0),
      overview: season.overview || '',
    })),
  };
}

export function detailsCaption(info) {
  const lines = [];
  if (info.title) lines.push(`*${info.title}*`);
  const bits = [
    info.type ? info.type : null,
    info.rating ? `IMDb ${info.rating}` : null,
    info.releaseDate || null,
  ].filter(Boolean);
  if (bits.length) lines.push(bits.join(' · '));
  if (info.genre) lines.push(info.genre);
  return lines.join('\n').trim();
}
