import fs from 'node:fs';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const defaults = {
  enabled: true,
  command: 'link-platform',
  aliases: ['link-platfrom', 'linkplatform', 'link'],
  unlinkCommand: 'unlink-platform',
  unlinkAliases: ['unlink-platfrom', 'unlinkplatform', 'unlink'],
  statusCommand: 'link-status',
  statusAliases: ['linkstatus', 'platform-status'],
  code: {
    length: 10,
    charset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    prefix: '',
  },
  ttlSeconds: 600,
  oneTime: true,
  maxActiveTokensPerIdentity: 3,
  allowRelink: true,
  dmOnly: true,
  session: {
    oneTimeUse: true,
    expiresAfterHours: 168,
    touchOnUse: true,
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export function loadPlatformLinkConfig() {
  let raw = {};
  if (fs.existsSync(env.PLATFORM_LINK_CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(env.PLATFORM_LINK_CONFIG_PATH, 'utf8'));
    } catch (error) {
      logger.warn({ err: error, path: env.PLATFORM_LINK_CONFIG_PATH }, 'failed to parse platform link config');
    }
  } else {
    logger.warn({ path: env.PLATFORM_LINK_CONFIG_PATH }, 'platform link config not found, using defaults');
  }
  const merged = deepMerge(defaults, raw);
  merged.code = {
    ...defaults.code,
    ...(merged.code || {}),
  };
  merged.session = {
    ...defaults.session,
    ...(merged.session || {}),
  };
  merged.aliases = Array.isArray(merged.aliases) ? merged.aliases : defaults.aliases;
  merged.unlinkAliases = Array.isArray(merged.unlinkAliases) ? merged.unlinkAliases : defaults.unlinkAliases;
  merged.statusAliases = Array.isArray(merged.statusAliases) ? merged.statusAliases : defaults.statusAliases;
  return merged;
}

export const platformLinkConfig = loadPlatformLinkConfig();

export function platformLinkEnabled() {
  return platformLinkConfig.enabled !== false;
}
