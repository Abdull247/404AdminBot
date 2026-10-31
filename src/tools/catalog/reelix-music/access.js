import { appConfig } from '../../../config/load-config.js';
import { isGroupJid } from '../../../whatsapp/filters.js';

function musicConfig() {
  return appConfig.bot?.reelixMusic || {};
}

export function reelixMusicEnabled() {
  return musicConfig().enabled !== false;
}

export function canAccessReelixMusic(context = {}) {
  if (!reelixMusicEnabled()) return false;
  const cfg = musicConfig();
  if (cfg.publicAccess === false) return false;
  const isGroup = isGroupJid(context.jid) || Boolean(context.environment?.isGroup);
  if (isGroup && cfg.allowInGroups === false) return false;
  return true;
}

export function canAccessReelixMusicStream(context = {}) {
  if (!canAccessReelixMusic(context)) return false;
  const cfg = musicConfig();
  if (cfg.allowStream === false) return false;
  const isGroup = isGroupJid(context.jid) || Boolean(context.environment?.isGroup);
  if (isGroup) return cfg.allowStreamInGroups !== false;
  return cfg.allowStreamInDms !== false;
}

export function publicStreamEndpointEnabled() {
  const cfg = musicConfig();
  return cfg.publicStreamEndpoint !== false && cfg.allowStream !== false;
}

export function defaultMusicSource() {
  const value = String(musicConfig().defaultSource || 'audiomack').toLowerCase();
  if (value === 'youtube' || value === 'spotify' || value === 'audiomack') return value;
  return 'audiomack';
}
