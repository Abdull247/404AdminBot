import fs from 'node:fs';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const defaults = {
  enabled: false,
  token: { env: 'TELEGRAM_BOT_TOKEN', required: true },
  botUsername: { env: 'TELEGRAM_BOT_USERNAME', required: false },
  commandPrefix: '/',
  ignoreGroups: true,
  ignoreStatus: true,
  respondToMentionsInGroups: true,
  respondToRepliesInGroups: true,
  reactInGroups: true,
  reactInDms: true,
  typingIndicator: true,
  ownerIds: [],
  logGroupMessages: true,
  parseMode: 'HTML',
  polling: {
    enabled: true,
    timeoutSeconds: 30,
    limit: 100,
    retryMs: 4000,
  },
  queue: {
    maxConcurrentChats: 4,
    maxPerChat: 8,
    maxGlobal: 48,
    notifyQueued: true,
  },
};

function readEnvSpec(spec) {
  if (!spec) return { name: '', required: false, value: '' };
  if (typeof spec === 'string') {
    return { name: spec, required: true, value: process.env[spec]?.trim() || '' };
  }
  const name = String(spec.env || spec.name || '').trim();
  const required = spec.required !== false;
  return { name, required, value: name ? (process.env[name]?.trim() || '') : '' };
}

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

export function loadTelegramConfig() {
  let raw = {};
  if (fs.existsSync(env.TELEGRAM_CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(env.TELEGRAM_CONFIG_PATH, 'utf8'));
    } catch (error) {
      logger.warn({ err: error, path: env.TELEGRAM_CONFIG_PATH }, 'failed to parse telegram config');
    }
  } else {
    logger.warn({ path: env.TELEGRAM_CONFIG_PATH }, 'telegram config not found, using defaults');
  }

  const merged = deepMerge(defaults, raw);
  const token = readEnvSpec(merged.token);
  const username = readEnvSpec(merged.botUsername);
  const envEnabled = env.TELEGRAM_ENABLED;
  const enabled = envEnabled === null ? Boolean(merged.enabled) : envEnabled;
  const ownerIds = [
    ...(Array.isArray(merged.ownerIds) ? merged.ownerIds : []),
    ...env.TELEGRAM_OWNER_IDS,
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  return {
    ...merged,
    enabled,
    token: token.value,
    tokenEnv: token.name,
    tokenRequired: token.required,
    botUsername: (username.value || env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    ownerIds: [...new Set(ownerIds)],
  };
}

export const telegramConfig = loadTelegramConfig();

export function telegramEnabled() {
  return Boolean(telegramConfig.enabled && telegramConfig.token);
}

export function telegramCommandPrefix() {
  return telegramConfig.commandPrefix || '/';
}
