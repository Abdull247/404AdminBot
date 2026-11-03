import { env } from './env.js';
import { appConfig } from './load-config.js';
import { logger } from '../utils/logger.js';
import {
  getCatalogRoles,
  getFallbackPolicy,
  loadProviderCatalog,
  normalizeModel,
  normalizeProvider,
  readEnvSpec,
} from './provider-catalog.js';

export { getCatalogRoles, getFallbackPolicy, loadProviderCatalog };

const cooldownUntil = new Map();

export { normalizeModel, normalizeProvider, readEnvSpec };

function now() {
  return Date.now();
}

function cooldownKey(providerId, modelId = '') {
  return modelId ? `${providerId}::${modelId}` : providerId;
}

export function markRuntimeCooldown(runtime, error, policy = getFallbackPolicy()) {
  if (!runtime) return 0;
  const status = Number(error?.status) || 0;
  let ms = policy.cooldownMs;
  if (status === 429) ms = policy.rateLimitCooldownMs;
  if (status === 401 || status === 403) ms = policy.authCooldownMs;
  const until = now() + ms;
  cooldownUntil.set(cooldownKey(runtime.providerId, runtime.modelId), until);
  cooldownUntil.set(cooldownKey(runtime.providerId), Math.max(cooldownUntil.get(cooldownKey(runtime.providerId)) || 0, until));
  return ms;
}

export function clearRuntimeCooldown(runtime) {
  if (!runtime) return;
  cooldownUntil.delete(cooldownKey(runtime.providerId, runtime.modelId));
}

function isCooling(providerId, modelId = '') {
  const until = cooldownUntil.get(cooldownKey(providerId, modelId)) || 0;
  return until > now();
}

export function listProviders({ enabledOnly = false } = {}) {
  const providers = loadProviderCatalog().providers || [];
  return enabledOnly ? providers.filter((provider) => provider.enabled !== false) : providers;
}

export function getDefaultProvider() {
  const providers = listProviders({ enabledOnly: true });
  return providers.find((provider) => provider.default) || providers[0] || null;
}

function roleHint(role) {
  const roles = getCatalogRoles();
  const raw = roles?.[role];
  if (!raw) return { providerId: '', modelId: '' };
  if (typeof raw === 'string') {
    const slash = raw.indexOf('/');
    if (slash > 0) return { providerId: raw.slice(0, slash), modelId: raw.slice(slash + 1) };
    return { providerId: '', modelId: raw };
  }
  return {
    providerId: String(raw.provider || raw.providerId || '').trim(),
    modelId: String(raw.model || raw.modelId || raw.id || '').trim(),
  };
}

export function findModel(modelRef) {
  const raw = String(modelRef || appConfig.ai?.defaultModel || appConfig.ai?.model || '').trim();
  const providers = listProviders();
  if (!raw) {
    const provider = getDefaultProvider() || providers[0];
    const model = provider?.models?.find((item) => item.enabled !== false && item.default)
      || provider?.models?.find((item) => item.enabled !== false)
      || provider?.models?.[0];
    return provider && model ? { provider, model } : null;
  }

  for (const provider of providers) {
    const model = provider.models.find((item) => item.id === raw);
    if (model) return { provider, model };
  }

  const slash = raw.indexOf('/');
  if (slash > 0) {
    const providerId = raw.slice(0, slash);
    const modelId = raw.slice(slash + 1);
    const named = providers.find((provider) => provider.id === providerId);
    if (named) {
      const model = named.models.find((item) => item.id === modelId || item.id === raw);
      if (model) return { provider: named, model };
    }
  }
  return null;
}

function extraHeaders(provider) {
  const headers = {};
  const raw = provider.headers || {};
  for (const [key, spec] of Object.entries(raw)) {
    const resolved = readEnvSpec(spec);
    if (resolved.value) headers[key] = resolved.value;
  }
  return headers;
}

export function resolveProviderRuntime(provider, model, { requireReady = true } = {}) {
  const baseUrl = readEnvSpec(provider.baseUrl);
  const apiKey = readEnvSpec(provider.apiKey);
  const timeout = readEnvSpec(provider.timeoutMs);

  if (requireReady) {
    if (baseUrl.required && !baseUrl.value) {
      throw new Error(`Missing env ${baseUrl.name || 'base URL'} for AI provider "${provider.id}"`);
    }
    if (apiKey.required && !apiKey.value) {
      throw new Error(`Missing env ${apiKey.name || 'API key'} for AI provider "${provider.id}"`);
    }
    if (!baseUrl.value) {
      throw new Error(`AI provider "${provider.id}" has no base URL`);
    }
  }

  const timeoutMs = Number.parseInt(
    timeout.value || String(model?.limits?.timeoutMs || env.AI_TIMEOUT_MS || 60000),
    10,
  );
  return {
    providerId: provider.id,
    providerName: provider.name || provider.id,
    modelId: model.id,
    model,
    imageSupport: Boolean(model.image_support || model.support?.vision),
    support: model.support || {},
    supportFallback: model.supportFallback !== false,
    roles: model.roles || [],
    baseUrl: String(baseUrl.value || '').replace(/\/+$/, ''),
    apiKey: apiKey.value,
    apiKeyNeeded: apiKey.required,
    extraHeaders: extraHeaders(provider),
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000,
    ready: Boolean(baseUrl.value && (!apiKey.required || apiKey.value)),
    freeTier: Boolean(provider.freeTier),
    kind: provider.kind || 'openai-compatible',
  };
}

function providerReady(provider) {
  const baseUrl = readEnvSpec(provider.baseUrl);
  const apiKey = readEnvSpec(provider.apiKey);
  if (!baseUrl.value) return false;
  if (apiKey.required && !apiKey.value) return false;
  return true;
}

function tryRuntime(provider, model, { requireReady = true } = {}) {
  try {
    const runtime = resolveProviderRuntime(provider, model, { requireReady });
    if (requireReady && !runtime.ready) return null;
    return runtime;
  } catch {
    return null;
  }
}

function modelSupports(model, needs = {}) {
  if (!model || model.enabled === false) return false;
  const support = model.support || {};
  if (needs.tools && support.tools === false) return false;
  if (needs.vision && !support.vision && !model.image_support) return false;
  if (needs.persistence && support.persistence === false && !(model.roles || []).includes('persistence')) return false;
  if (needs.role && Array.isArray(model.roles) && model.roles.length && !model.roles.includes(needs.role)) {
    if (needs.role === 'chat' && support.chat !== false) return true;
    if (needs.role === 'vision' && (support.vision || model.image_support)) return true;
    if (needs.role === 'persistence' && support.persistence) return true;
    return false;
  }
  return true;
}

function sortCandidates(items, preferredProviderId) {
  return [...items].sort((a, b) => {
    const aSame = a.provider.id === preferredProviderId ? 1 : 0;
    const bSame = b.provider.id === preferredProviderId ? 1 : 0;
    if (aSame !== bSame) return bSame - aSame;
    if (a.provider.priority !== b.provider.priority) return b.provider.priority - a.provider.priority;
    if (a.model.priority !== b.model.priority) return b.model.priority - a.model.priority;
    return a.model.id.localeCompare(b.model.id);
  });
}

export function listFallbackChain({
  start,
  needs = {},
  includeStart = true,
  fallbackOnly = false,
} = {}) {
  const policy = getFallbackPolicy();
  const preferredProviderId = start?.provider?.id || getDefaultProvider()?.id || '';
  const chain = [];
  const seen = new Set();

  const push = (provider, model, reason) => {
    if (!provider || !model) return;
    const key = `${provider.id}::${model.id}`;
    if (seen.has(key)) return;
    if (provider.enabled === false || model.enabled === false) return;
    if ((fallbackOnly || reason !== 'start') && model.supportFallback === false) return;
    if (!modelSupports(model, needs)) return;
    if (isCooling(provider.id, model.id)) return;
    const runtime = tryRuntime(provider, model, { requireReady: policy.skipMissingKeys });
    if (!runtime) return;
    seen.add(key);
    chain.push({ provider, model, runtime, reason });
  };

  if (includeStart && start?.provider && start?.model) {
    push(start.provider, start.model, 'start');
  }

  if (policy.preferSameProvider && start?.provider) {
    const siblings = [...(start.provider.models || [])]
      .filter((model) => model.id !== start.model?.id)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const model of siblings) {
      push(start.provider, model, 'same-provider');
    }
  }

  if (policy.allowCrossProvider) {
    const others = sortCandidates(
      listProviders({ enabledOnly: true }).flatMap((provider) => (
        provider.models.map((model) => ({ provider, model }))
      )),
      preferredProviderId,
    );
    for (const item of others) {
      push(item.provider, item.model, item.provider.id === preferredProviderId ? 'same-provider' : 'next-provider');
    }
  }

  return chain;
}

function defaultModelRef() {
  return String(appConfig.ai?.defaultModel || appConfig.ai?.model || '').trim();
}

export function resolveRoleMatch(role, modelRef) {
  const requested = String(modelRef || '').trim();
  if (requested) {
    const found = findModel(requested);
    if (found) return found;
  }
  if (role) {
    const hint = roleHint(role);
    if (hint.providerId && hint.modelId) {
      const named = findModel(`${hint.providerId}/${hint.modelId}`);
      if (named) return named;
    }
    if (hint.modelId) {
      const byId = findModel(hint.modelId);
      if (byId) return byId;
    }
    if (hint.providerId) {
      const provider = listProviders().find((item) => item.id === hint.providerId);
      const model = provider?.models?.find((item) => item.enabled !== false && (item.default || (item.roles || []).includes(role)))
        || provider?.models?.find((item) => item.enabled !== false);
      if (provider && model) return { provider, model };
    }
    for (const provider of listProviders({ enabledOnly: true })) {
      const model = provider.models.find((item) => item.enabled !== false && modelSupports(item, { role }));
      if (model) return { provider, model };
    }
  }
  return findModel(defaultModelRef());
}

let cachedRuntime = null;

export function getAiRuntime(modelRef, options = {}) {
  const requested = String(modelRef || '').trim();
  if (cachedRuntime && !requested && !options.role && !options.force) return cachedRuntime;

  const role = options.role || 'chat';
  const needs = {
    role,
    vision: role === 'vision' || Boolean(options.vision),
    tools: Boolean(options.tools),
    persistence: role === 'persistence',
  };
  let match = resolveRoleMatch(role, requested || (role === 'chat' ? defaultModelRef() : ''));
  let chain = listFallbackChain({
    start: match,
    needs,
    includeStart: true,
  });
  if (!chain.length && role && role !== 'chat') {
    match = resolveRoleMatch('chat', defaultModelRef());
    chain = listFallbackChain({
      start: match,
      needs: {
        role: 'chat',
        tools: Boolean(options.tools),
        vision: Boolean(options.vision),
      },
      includeStart: true,
    });
  }
  const runtime = chain[0]?.runtime || null;
  if (!runtime?.ready) {
    throw new Error(`AI default model not found or not ready in providers: ${requested || role || '(none)'}`);
  }
  if (!requested && !options.role) cachedRuntime = runtime;
  logger.debug({
    provider: runtime.providerId,
    model: runtime.modelId,
    imageSupport: runtime.imageSupport,
    role,
  }, 'resolved AI runtime');
  return runtime;
}

export function currentModelSupportsImages(runtime) {
  return Boolean((runtime || getAiRuntime()).imageSupport);
}

export function describeCatalog() {
  const catalog = loadProviderCatalog();
  return {
    defaultProvider: catalog.defaultProvider || getDefaultProvider()?.id || null,
    fallback: catalog.fallback,
    roles: catalog.roles,
    providers: listProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: provider.enabled !== false,
      default: Boolean(provider.default),
      freeTier: Boolean(provider.freeTier),
      ready: providerReady(provider),
      models: provider.models.map((model) => ({
        id: model.id,
        name: model.name,
        enabled: model.enabled !== false,
        default: Boolean(model.default),
        supportFallback: model.supportFallback !== false,
        roles: model.roles || [],
        support: model.support || {},
      })),
    })),
  };
}

export function providerHasVision() {
  return listProviders({ enabledOnly: true }).some((provider) => (
    providerReady(provider)
    && provider.models.some((model) => model.enabled !== false && (model.support?.vision || model.image_support))
  ));
}
