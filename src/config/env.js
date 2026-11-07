import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

function required(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function optionalBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function optionalInt(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return parsed;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function detectPort() {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') {
    return optionalBool('HEALTH_SERVER', false) ? 10000 : 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error('Environment variable PORT must be an integer');
  }
  return parsed;
}

function optionalIntWithDefaultMs(name, fallbackMs) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer (milliseconds)`);
  }
  return parsed;
}

const phoneNumber = normalizePhone(optional('WHATSAPP_PHONE_NUMBER', ''));
const port = detectPort();

export const env = {
  ROOT_DIR: rootDir,
  AI_BASE_URL: optional('AI_BASE_URL', '').replace(/\/+$/, ''),
  AI_API_KEY: optional('AI_API_KEY', ''),
  AI_TIMEOUT_MS: optionalInt('AI_TIMEOUT_MS', 60000),
  NVIDIA_BASE_URL: optional('NVIDIA_BASE_URL', 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
  NVIDIA_API_KEY: optional('NVIDIA_API_KEY', ''),
  HCNSEC_BASE_URL: optional('HCNSEC_BASE_URL', 'https://api.hcnsec.cn/v1').replace(/\/+$/, ''),
  HCNSEC_API_KEY: optional('HCNSEC_API_KEY', ''),
  AGNES_BASE_URL: optional('AGNES_BASE_URL', 'https://apihub.agnes-ai.com/v1').replace(/\/+$/, ''),
  AGNES_API_KEY: optional('AGNES_API_KEY', ''),
  KIRA_BASE_URL: optional('KIRA_BASE_URL', 'https://kiraai.vn/api/v1').replace(/\/+$/, ''),
  KIRA_API_KEY: optional('KIRA_API_KEY', ''),
  DATABASE_URL: required('DATABASE_URL'),
  WHATSAPP_SESSION_DIR: path.resolve(rootDir, optional('WHATSAPP_SESSION_DIR', './session')),
  WHATSAPP_AUTH_STORE: optional('WHATSAPP_AUTH_STORE', port ? 'postgres' : 'file'),
  WHATSAPP_PRINT_QR: optionalBool('WHATSAPP_PRINT_QR', true),
  WHATSAPP_PHONE_NUMBER: phoneNumber,
  WHATSAPP_USE_PAIRING_CODE: optionalBool('WHATSAPP_USE_PAIRING_CODE', Boolean(phoneNumber)),
  OWNER_NUMBERS: optional('OWNER_NUMBERS', phoneNumber),
  HOST: optional('HOST', '0.0.0.0'),
  PORT: port,
  WHATSAPP_MAX_STALE_MS: optionalIntWithDefaultMs('WHATSAPP_MAX_STALE_MS', 10 * 60 * 1000),
  LOG_LEVEL: optional('LOG_LEVEL', 'info'),
  CONFIG_PATH: path.resolve(rootDir, optional('CONFIG_PATH', './config.json')),
  PROVIDERS_PATH: path.resolve(rootDir, optional('PROVIDERS_PATH', './providers')),
  SANDBOXES_PATH: path.resolve(rootDir, optional('SANDBOXES_PATH', './sandboxes.json')),
  STICKERS_PATH: path.resolve(rootDir, optional('STICKERS_PATH', './stickers/config.json')),
  TOOLS_OUTPUT_DIR: path.resolve(rootDir, optional('TOOLS_OUTPUT_DIR', './generated')),
  PERSISTENCE_AGENT_ENABLED: optionalBool('PERSISTENCE_AGENT_ENABLED', true),
  PERSISTENCE_MAX_CONCURRENT: optionalInt('PERSISTENCE_MAX_CONCURRENT', 0),
  PERSISTENCE_MAX_RUNTIME_MINUTES: optionalInt('PERSISTENCE_MAX_RUNTIME_MINUTES', 0),
  PERSISTENCE_POLL_MS: optionalInt('PERSISTENCE_POLL_MS', 0),
  PERSISTENCE_LEASE_SECONDS: optionalInt('PERSISTENCE_LEASE_SECONDS', 0),
  PERSISTENCE_WORKER_ID: optional('PERSISTENCE_WORKER_ID', ''),
  PERSISTENCE_WORKSPACE_ROOT: optional('PERSISTENCE_WORKSPACE_ROOT', ''),
  LANGSEARCH_API_KEY: optional('LANGSEARCH_API_KEY', ''),
  LANGSEARCH_BASE_URL: optional('LANGSEARCH_BASE_URL', 'https://api.langsearch.com/v1/web-search').replace(/\/+$/, ''),
  DEFAULT_TIMEZONE: optional('DEFAULT_TIMEZONE', 'UTC'),
  E2B_API_KEY: optional('E2B_API_KEY', ''),
  E2B_TIMEOUT_MS: optionalInt('E2B_TIMEOUT_MS', 300000),
  INSTABOX_API_KEY: optional('INSTABOX_API_KEY', ''),
  INSTABOX_API_URL: optional('INSTABOX_API_URL', 'https://api.instabox.sh').replace(/\/+$/, ''),
  INSTABOX_TEMPLATE: optional('INSTABOX_TEMPLATE', 'agent-browser'),
  INSTABOX_MACHINE_ID: optional('INSTABOX_MACHINE_ID', ''),
  R2_ACCESS_KEY_ID: optional('R2_ACCESS_KEY_ID', ''),
  R2_SECRET_ACCESS_KEY: optional('R2_SECRET_ACCESS_KEY', ''),
  R2_BUCKET_NAME: optional('R2_BUCKET_NAME', ''),
  R2_ENDPOINT: optional('R2_ENDPOINT', '').replace(/\/+$/, ''),
  R2_PUBLIC_URL: optional('R2_PUBLIC_URL', '').replace(/\/+$/, ''),
  R2_ACCOUNT_ID: optional('R2_ACCOUNT_ID', ''),
  CLOUDFLARE_ACCOUNT_ID: optional('CLOUDFLARE_ACCOUNT_ID', ''),
  CLOUDFLARE_API_TOKEN: optional('CLOUDFLARE_API_TOKEN', ''),
  CLOUDFLARE_CONFIG_PATH: path.resolve(rootDir, optional('CLOUDFLARE_CONFIG_PATH', './cloudflare.json')),
  SCREENSHOTLAYER_API_KEY: optional('SCREENSHOTLAYER_API_KEY', '36ba2cccc19800bc5f098110779c083d'),
  SCREENSHOTLAYER_SECRET: optional('SCREENSHOTLAYER_SECRET', ''),
  SCREENSHOTLAYER_BASE_URL: optional(
    'SCREENSHOTLAYER_BASE_URL',
    'https://api.screenshotlayer.com/api/capture',
  ).replace(/\/+$/, ''),
  REELIX_PROXY_BASE_URL: optional(
    'REELIX_PROXY_BASE_URL',
    'https://reelixproxy.onrender.com',
  ).replace(/\/+$/, ''),
  REELIX_BOT_KEY: optional('REELIX_BOT_KEY', ''),
  REELIX_BOT_HMAC_SECRET: optional('REELIX_BOT_HMAC_SECRET', ''),
  REELIX_BOT_TIMEOUT_MS: optionalInt('REELIX_BOT_TIMEOUT_MS', 30000),
  REELIX_DOWNLOAD_NUMBERS: optional('REELIX_DOWNLOAD_NUMBERS', ''),
  REELIX_ADMIN_NUMBERS: optional('REELIX_ADMIN_NUMBERS', ''),
  REELIX_GROUP_JID: optional('REELIX_GROUP_JID', ''),
  REELIX_GROUP_ENABLED: optionalBool('REELIX_GROUP_ENABLED', true),
  REELIX_CHANNEL_JID: optional('REELIX_CHANNEL_JID', ''),
  REELIX_CHANNEL_INVITE: optional('REELIX_CHANNEL_INVITE', ''),
  REELIX_CHANNEL_ENABLED: optionalBool('REELIX_CHANNEL_ENABLED', false),
  REELIX_RESTRICT_ACCESS: optionalBool('REELIX_RESTRICT_ACCESS', false),
  REELIX_SEND_KEY: optional('REELIX_SEND_KEY', ''),
  REELIX_VIDEO_MAX_MB: optionalInt('REELIX_VIDEO_MAX_MB', 500),
  REELIX_VIDEO_TIMEOUT_MS: optionalIntWithDefaultMs('REELIX_VIDEO_TIMEOUT_MS', 300000),
  REELIX_VIDEO_REFERER: optional('REELIX_VIDEO_REFERER', ''),
  REELIX_VIDEO_USER_AGENT: optional('REELIX_VIDEO_USER_AGENT', ''),
  REELIX_MUSIC_PROXY_BASE_URL: optional(
    'REELIX_MUSIC_PROXY_BASE_URL',
    'https://reelixmusicproxy.onrender.com',
  ).replace(/\/+$/, ''),
  REELIX_MUSIC_BOT_KEY: optional('REELIX_MUSIC_BOT_KEY', ''),
  REELIX_MUSIC_BOT_HMAC_SECRET: optional('REELIX_MUSIC_BOT_HMAC_SECRET', ''),
  REELIX_MUSIC_BOT_TIMEOUT_MS: optionalInt('REELIX_MUSIC_BOT_TIMEOUT_MS', 30000),
  REELIX_MUSIC_AUDIO_MAX_MB: optionalInt('REELIX_MUSIC_AUDIO_MAX_MB', 50),
  REELIX_MUSIC_AUDIO_TIMEOUT_MS: optionalIntWithDefaultMs('REELIX_MUSIC_AUDIO_TIMEOUT_MS', 180000),
  BASE_URL: optional('BASE_URL', '').replace(/\/+$/, ''),
  TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED === undefined || process.env.TELEGRAM_ENABLED === ''
    ? null
    : optionalBool('TELEGRAM_ENABLED', true),
  TELEGRAM_BOT_TOKEN: optional('TELEGRAM_BOT_TOKEN', ''),
  TELEGRAM_BOT_USERNAME: optional('TELEGRAM_BOT_USERNAME', '').replace(/^@/, ''),
  TELEGRAM_OWNER_IDS: optional('TELEGRAM_OWNER_IDS', '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  TELEGRAM_CONFIG_PATH: path.resolve(rootDir, optional('TELEGRAM_CONFIG_PATH', './telegram.json')),
  PLATFORM_LINK_CONFIG_PATH: path.resolve(rootDir, optional('PLATFORM_LINK_CONFIG_PATH', './platform-link.json')),
};

if (env.E2B_API_KEY && !process.env.E2B_API_KEY) {
  process.env.E2B_API_KEY = env.E2B_API_KEY;
}

if (env.INSTABOX_API_KEY && !process.env.INSTABOX_API_KEY) {
  process.env.INSTABOX_API_KEY = env.INSTABOX_API_KEY;
}

if (env.INSTABOX_API_URL && !process.env.INSTABOX_API_URL) {
  process.env.INSTABOX_API_URL = env.INSTABOX_API_URL;
}

export function ensureSessionDir() {
  fs.mkdirSync(env.WHATSAPP_SESSION_DIR, { recursive: true });
}

export function ensureToolsOutputDir() {
  fs.mkdirSync(env.TOOLS_OUTPUT_DIR, { recursive: true });
}
