import { canAccessReelixDownload } from '../tools/catalog/reelix-movies/access.js';
import { reelixConfigured } from '../tools/catalog/reelix-movies/client.js';
import { handler as reelixMovies } from '../tools/catalog/reelix-movies/handler.js';
import { detailsCaption } from '../tools/catalog/reelix-movies/format.js';
import { HOURGLASS, POPCORN, reactToMessage } from '../whatsapp/react.js';

function parseArg(arg) {
  const raw = String(arg || '').trim();
  if (!raw) return { action: 'help', rest: '' };
  const parts = raw.split(/\s+/);
  const first = parts[0].toLowerCase();
  const actions = new Set(['search', 'details', 'detail', 'info', 'resources', 'cast', 'seasons', 'season', 'download', 'dl']);
  if (actions.has(first)) {
    const action = first === 'detail' || first === 'info'
      ? 'details'
      : first === 'season' ? 'seasons'
        : first === 'dl' ? 'download'
          : first;
    return { action, rest: parts.slice(1).join(' ').trim() };
  }
  return { action: 'search', rest: raw };
}

function helpText(context = {}) {
  const lines = [
    '*Reelix*',
    '',
    'Search movies and series, then pull details, cast, or resources.',
    '',
    '*.reelix <title>*',
    '  Search, then show the top match with its banner.',
    '*.reelix search <title>*',
    '  Search only and list matches.',
    '*.reelix details <subjectId>*',
    '  Full details plus banner for a known id.',
    '*.reelix cast <subjectId>*',
    '*.reelix resources <subjectId>*',
    '*.reelix seasons <subjectId>*',
  ];
  if (canAccessReelixDownload(context)) {
    lines.push('*.reelix download <subjectId> [quality]*');
    lines.push('  Direct download URL. Error404 added this number to the allowed list.');
    lines.push('*.reelix download <subjectId> --video [quality]*');
    lines.push('  Download and send the mp4 as a video file.');
    lines.push('*.reelix download <subjectId> --video --always*');
    lines.push('  Same, and remember to always send Reelix files as mp4.');
  }
  return lines.join('\n');
}

function formatSearchList(summary) {
  if (!summary.results?.length) {
    return `No Reelix titles matched "${summary.keyword || 'that'}".`;
  }
  const lines = [`*Reelix search* · ${summary.keyword}`, ''];
  summary.results.slice(0, 8).forEach((item, index) => {
    const bits = [item.type, item.rating ? `IMDb ${item.rating}` : null, item.releaseDate || null]
      .filter(Boolean)
      .join(' · ');
    lines.push(`${index + 1}. *${item.title}*`);
    lines.push(`   ${bits || item.subjectId}  id ${item.subjectId}`);
  });
  lines.push('');
  lines.push('Details: .reelix details <id>');
  return lines.join('\n');
}

function formatDetails(info) {
  const lines = [detailsCaption(info)];
  if (info.country) lines.push(info.country);
  if (info.description) {
    lines.push('');
    lines.push(info.description.length > 700 ? `${info.description.slice(0, 700).trim()}…` : info.description);
  }
  if (info.subjectId) {
    lines.push('');
    lines.push(`id ${info.subjectId}  ·  .reelix cast ${info.subjectId}`);
  }
  return lines.filter(Boolean).join('\n').trim();
}

function formatCast(info) {
  const lines = [`*Cast*${info.subjectId ? ` · ${info.subjectId}` : ''}`, ''];
  if (!info.cast?.length && !info.crew?.length) return 'No cast was returned for that title.';
  for (const person of info.cast || []) {
    lines.push(`• ${person.name}${person.character ? ` as ${person.character}` : ''}`);
  }
  if (info.crew?.length) {
    lines.push('');
    lines.push('*Crew*');
    for (const person of info.crew) {
      lines.push(`• ${person.name}${person.job ? ` · ${person.job}` : ''}`);
    }
  }
  return lines.join('\n');
}

function formatResources(info) {
  const lines = [`*Resources*${info.title ? ` · ${info.title}` : ''}`, ''];
  if (info.genre) lines.push(info.genre);
  if (info.totalEpisode) lines.push(`${info.totalEpisode} episode resource(s)`);
  if (!info.items?.length) {
    lines.push('No resource rows came back.');
    return lines.join('\n');
  }
  lines.push('');
  for (const item of info.items.slice(0, 12)) {
    const label = [item.title, item.quality, item.size].filter(Boolean).join(' · ');
    const ep = item.season || item.episode
      ? `S${item.season || '-'}E${item.episode || '-'}`
      : '';
    lines.push(`• ${[ep, label].filter(Boolean).join(' ')}`.trim());
  }
  if (info.total > 12) lines.push(`…and ${info.total - 12} more`);
  return lines.join('\n');
}

function parseDownloadArg(rest) {
  const raw = String(rest || '').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const positional = parts.filter((part) => !part.startsWith('--'));
  const subjectId = positional[0] || '';
  const extra = positional.slice(1).join(' ').trim();
  const resolution = extra.match(/\b(\d{3,4})p?\b/i);
  return {
    subjectId,
    quality: extra || undefined,
    resolution: resolution ? Number.parseInt(resolution[1], 10) : undefined,
    sendVideo: parts.includes('--video'),
    always: parts.includes('--always'),
  };
}

function formatDownload(info) {
  const lines = [
    `*Download*${info.title ? ` · ${info.title}` : ''}`,
    '',
    'Error404 added this number to the allowed list for Reelix download links. Most people do not have this access.',
    '',
  ];
  if (info.url) {
    const bits = [info.quality, info.resolution ? `${info.resolution}p` : null, info.size]
      .filter(Boolean)
      .join(' · ');
    if (bits) lines.push(bits);
    lines.push(info.url);
  }
  const extras = (info.items || []).slice(1, 6);
  if (extras.length) {
    lines.push('');
    lines.push('*Other qualities*');
    for (const item of extras) {
      const bits = [item.quality, item.resolution ? `${item.resolution}p` : null, item.size]
        .filter(Boolean)
        .join(' · ');
      lines.push(`• ${bits || item.resourceId}`);
      if (item.url) lines.push(`  ${item.url}`);
    }
  }
  return lines.join('\n').trim();
}

function formatSeasons(info) {
  const lines = [`*Seasons*${info.title ? ` · ${info.title}` : ''}`, ''];
  if (!info.seasons?.length) return 'No season list came back for that title.';
  for (const season of info.seasons) {
    const count = season.episodeCount ? `${season.episodeCount} ep` : '';
    lines.push(`• Season ${season.season ?? '?'} ${season.title || ''} ${count}`.trim());
  }
  return lines.join('\n');
}

async function maybeReact(sock, message, emoji) {
  if (!sock || !message) return;
  await reactToMessage(sock, message, emoji);
}

export async function handleReelix({ arg, sock, message, jid }) {
  if (!reelixConfigured()) {
    return 'Reelix is not configured. Set REELIX_PROXY_BASE_URL, REELIX_BOT_KEY, and REELIX_BOT_HMAC_SECRET.';
  }

  const parsed = parseArg(arg);
  const context = { jid, sock, message };
  if (parsed.action === 'help') return helpText(context);

  await maybeReact(sock, message, HOURGLASS);

  try {
    if (parsed.action === 'search' && parsed.rest) {
      const search = await reelixMovies({ action: 'search', query: parsed.rest }, context);
      if (!search.ok) return search.error || 'Reelix search failed.';
      const top = search.results?.[0];
      if (top?.subjectId) {
        const details = await reelixMovies({ action: 'details', subjectId: top.subjectId }, context);
        if (details.ok) {
          await maybeReact(sock, message, POPCORN);
          const extras = search.results.slice(1, 6);
          const extraLines = extras.length
            ? ['', '*Other matches*', ...extras.map((item, index) => `${index + 2}. *${item.title}* · ${item.type} · id ${item.subjectId}`)]
            : [];
          return {
            text: [formatDetails(details), ...extraLines].join('\n'),
            artifacts: details.files || [],
          };
        }
      }
      await maybeReact(sock, message, POPCORN);
      return { text: formatSearchList(search), artifacts: [] };
    }

    if (parsed.action === 'details') {
      const subjectId = parsed.rest;
      if (!subjectId) return 'Give a subject id, for example .reelix details 111.';
      const details = await reelixMovies({ action: 'details', subjectId }, context);
      if (!details.ok) return details.error || 'Reelix details failed.';
      await maybeReact(sock, message, POPCORN);
      return { text: formatDetails(details), artifacts: details.files || [] };
    }

    if (parsed.action === 'cast') {
      if (!parsed.rest) return 'Give a subject id, for example .reelix cast 111.';
      const cast = await reelixMovies({ action: 'cast', subjectId: parsed.rest }, context);
      if (!cast.ok) return cast.error || 'Reelix cast failed.';
      await maybeReact(sock, message, POPCORN);
      return formatCast(cast);
    }

    if (parsed.action === 'resources') {
      if (!parsed.rest) return 'Give a subject id, for example .reelix resources 111.';
      const resources = await reelixMovies({ action: 'resources', subjectId: parsed.rest }, context);
      if (!resources.ok) return resources.error || 'Reelix resources failed.';
      await maybeReact(sock, message, POPCORN);
      return formatResources(resources);
    }

    if (parsed.action === 'seasons') {
      if (!parsed.rest) return 'Give a subject id, for example .reelix seasons 111.';
      const seasons = await reelixMovies({ action: 'seasons', subjectId: parsed.rest }, context);
      if (!seasons.ok) return seasons.error || 'Reelix seasons failed.';
      await maybeReact(sock, message, POPCORN);
      return formatSeasons(seasons);
    }

    if (parsed.action === 'download') {
      if (!canAccessReelixDownload(context)) {
        await maybeReact(sock, message, POPCORN);
        return 'Download links are not available in this chat.';
      }
      const parsedDownload = parseDownloadArg(parsed.rest);
      if (!parsedDownload.subjectId) return 'Give a subject id, for example .reelix download 111 1080p.';
      const download = await reelixMovies({
        action: 'download',
        subjectId: parsedDownload.subjectId,
        quality: parsedDownload.quality,
        resolution: parsedDownload.resolution,
        sendVideo: parsedDownload.sendVideo,
        rememberVideoPreference: parsedDownload.always,
      }, context);
      if (!download.ok) return download.error || 'Reelix download failed.';
      await maybeReact(sock, message, POPCORN);
      if (download.sentAsVideo) {
        const bits = [download.title, download.quality, download.size].filter(Boolean).join(' · ');
        return {
          text: ['*Video sent*', bits ? `  ${bits}` : '', download.videoFile ? `  ${download.videoFile.filename}` : ''].filter(Boolean).join('\n'),
          artifacts: download.files || [],
        };
      }
      if (download.videoError) {
        return `${formatDownload(download)}\n\nCould not send the video (${download.videoError}).`;
      }
      return formatDownload(download);
    }

    return helpText(context);
  } catch (error) {
    await maybeReact(sock, message, POPCORN);
    return error.message || 'Reelix request failed.';
  }
}
