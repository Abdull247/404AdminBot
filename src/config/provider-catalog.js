import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { appConfig } from './load-config.js';
import { logger } from '../utils/logger.js';

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  }
  return fallback;
}

function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function catalogRoot() {
  return path.resolve(env.ROOT_DIR, env.PROVIDERS_PATH || appConfig.ai?.catalogPath || './providers');
}

export function isLiteralValue(value) {
  return /^(https?:\/\/|\/)/.test(String(value || ''));
}

export function readEnvSpec(spec) {
  if (!spec) return { name: '', required: false, value: '' };
  if (typeof spec === 'string') {
    if (isLiteralValue(spec)) return { name: '', required: false, value: spec.replace(/\/+$/, '') };
    return { name: spec, required: true, value: process.env[spec]?.trim() || '' };
  }
  const name = String(spec.env || spec.name || '').trim();
  const required = spec.required !== false && spec.keyNeeded !== false;
  const fromEnv = name ? (process.env[name]?.trim() || '') : '';
  const literal = spec.value || spec.url || '';
  return { name, required, value: fromEnv || literal };
}

function normalizeSupport(raw = {}) {
  const support = raw.support || raw.surport || {};
  const vision = asBool(
    support.vision
      ?? support.image
      ?? support.image_support
      ?? support.image_surport
      ?? raw.image_support
      ?? raw.image_surport
      ?? raw.imageSupport
      ?? raw.vision,
    false,
  );
  return {
    chat: asBool(support.chat ?? raw.chat, true),
    tools: asBool(support.tools ?? raw.tools, true),
    vision,
    streaming: asBool(support.streaming ?? raw.stream ?? raw.streaming, false),
    json: asBool(support.json ?? raw.json, false),
    persistence: asBool(support.persistence ?? raw.persistence, false),
  };
}

export function normalizeModel(raw, fallbackId, index = 0) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return normalizeModel({ id: raw }, fallbackId, index);
  }
  const id = String(raw.id || raw.model || raw.name || fallbackId || '').trim();
  if (!id) return null;
  const support = normalizeSupport(raw);
  const limits = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
  const roles = Array.isArray(raw.roles) ? raw.roles.map((item) => String(item).trim()).filter(Boolean) : [];
  return {
    ...raw,
    id,
    name: String(raw.name || id).trim(),
    enabled: raw.enabled !== false,
    default: asBool(raw.default, false),
    supportFallback: asBool(
      raw.supportFallback ?? raw.support_fallback ?? raw.surportFallback ?? raw.surport_fallback,
      true,
    ),
    priority: asInt(raw.priority, 50 - index),
    roles,
    support,
    image_support: support.vision,
    limits: {
      maxTokens: asInt(limits.maxTokens ?? raw.maxTokens, 0) || undefined,
      contextWindow: asInt(limits.contextWindow ?? raw.contextWindow, 0) || undefined,
      timeoutMs: asInt(limits.timeoutMs ?? raw.timeoutMs, 0) || undefined,
    },
  };
}

export function normalizeProvider(raw, index = 0) {
  const id = String(raw?.id || raw?.name || `provider-${index + 1}`).trim();
  const models = Array.isArray(raw?.models)
    ? raw.models.map((model, modelIndex) => normalizeModel(model, `${id}-model-${modelIndex + 1}`, modelIndex)).filter(Boolean)
    : [];
  return {
    id,
    name: String(raw?.name || id).trim(),
    enabled: raw?.enabled !== false,
    default: asBool(raw?.default, false),
    priority: asInt(raw?.priority, 50 - index),
    kind: String(raw?.kind || 'openai-compatible').trim(),
    freeTier: asBool(raw?.freeTier ?? raw?.free_tier, false),
    baseUrl: raw?.baseUrl || raw?.base_url || { env: 'AI_BASE_URL', required: true },
    apiKey: raw?.apiKey || raw?.api_key || { env: 'AI_API_KEY', required: true },
    timeoutMs: raw?.timeoutMs || raw?.timeout_ms || { env: 'AI_TIMEOUT_MS', required: false },
    headers: raw?.headers && typeof raw.headers === 'object' ? raw.headers : {},
    notes: String(raw?.notes || '').trim(),
    source: raw?.source || 'config',
    models,
  };
}

function loadCatalogMeta(root) {
  const filePath = path.join(root, 'catalog.json');
  let raw = {};
  if (fs.existsSync(filePath)) {
    try {
      raw = readJson(filePath);
    } catch (error) {
      logger.warn({ err: error, path: filePath }, 'failed to parse provider catalog.json');
    }
  }
  const fallback = {
    ...(raw.fallback && typeof raw.fallback === 'object' ? raw.fallback : {}),
    ...(appConfig.ai?.fallback && typeof appConfig.ai.fallback === 'object' ? appConfig.ai.fallback : {}),
  };
  return {
    version: asInt(raw.version, 1),
    defaultProvider: String(raw.defaultProvider || appConfig.ai?.defaultProvider || '').trim(),
    roles: raw.roles && typeof raw.roles === 'object' ? raw.roles : {},
    fallback: {
      enabled: fallback.enabled !== false,
      maxAttempts: asInt(fallback.maxAttempts, 10),
      cooldownMs: asInt(fallback.cooldownMs, 20000),
      rateLimitCooldownMs: asInt(fallback.rateLimitCooldownMs, 60000),
      authCooldownMs: asInt(fallback.authCooldownMs, 300000),
      skipMissingKeys: fallback.skipMissingKeys !== false,
      preferSameProvider: fallback.preferSameProvider !== false,
      allowCrossProvider: fallback.allowCrossProvider !== false,
    },
  };
}

function loadFolderProvider(dirPath, index) {
  const providerFile = path.join(dirPath, 'provider.json');
  if (!fs.existsSync(providerFile)) return null;
  const raw = readJson(providerFile);
  const modelsFile = path.join(dirPath, 'models', 'config.json');
  let modelsRaw = { models: raw.models || [] };
  if (fs.existsSync(modelsFile)) {
    modelsRaw = readJson(modelsFile);
  }
  const folderId = path.basename(dirPath);
  return normalizeProvider({
    ...raw,
    id: raw.id || folderId,
    models: modelsRaw.models || [],
    default: raw.default,
    source: 'folder',
    defaultModel: modelsRaw.defaultModel,
  }, index);
}

function loadLegacyProviders() {
  const providers = Array.isArray(appConfig.ai?.providers) ? appConfig.ai.providers : [];
  return providers.map((provider, index) => normalizeProvider({ ...provider, source: 'config' }, index));
}

function mergeProviders(folderProviders, legacyProviders) {
  const byId = new Map();
  for (const provider of [...legacyProviders, ...folderProviders]) {
    const existing = byId.get(provider.id);
    if (!existing) {
      byId.set(provider.id, provider);
      continue;
    }
    const models = [...existing.models];
    const seen = new Set(models.map((model) => model.id));
    for (const model of provider.models) {
      if (seen.has(model.id)) {
        const index = models.findIndex((item) => item.id === model.id);
        models[index] = { ...models[index], ...model };
      } else {
        models.push(model);
        seen.add(model.id);
      }
    }
    byId.set(provider.id, {
      ...existing,
      ...provider,
      models,
      source: provider.source || existing.source,
    });
  }
  return [...byId.values()].sort((a, b) => (b.priority - a.priority) || a.id.localeCompare(b.id));
}

let cached = null;

export function loadProviderCatalog(force = false) {
  if (cached && !force) return cached;
  const root = catalogRoot();
  const meta = loadCatalogMeta(root);
  const folderProviders = [];
  if (fs.existsSync(root)) {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    let index = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const provider = loadFolderProvider(path.join(root, entry.name), index);
        if (provider) {
          folderProviders.push(provider);
          index += 1;
        }
      } catch (error) {
        logger.warn({ err: error, provider: entry.name }, 'failed to load provider folder');
      }
    }
  } else {
    logger.warn({ path: root }, 'provider catalog folder not found');
  }

  const providers = mergeProviders(folderProviders, loadLegacyProviders());
  if (meta.defaultProvider) {
    for (const provider of providers) {
      provider.default = provider.id === meta.defaultProvider;
    }
  } else {
    const marked = providers.find((provider) => provider.default && provider.enabled !== false);
    if (!marked && providers.length) providers[0].default = true;
  }

  cached = {
    root,
    ...meta,
    providers,
  };
  logger.debug({
    root,
    providers: providers.map((provider) => ({
      id: provider.id,
      enabled: provider.enabled,
      models: provider.models.length,
      default: provider.default,
    })),
  }, 'loaded AI provider catalog');
  return cached;
}

export function getFallbackPolicy() {
  return loadProviderCatalog().fallback;
}

export function getCatalogRoles() {
  return loadProviderCatalog().roles || {};
}
