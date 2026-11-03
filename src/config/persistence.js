import { env } from './env.js';
import { appConfig } from './load-config.js';
import { getAiRuntime } from './providers.js';
import { getPersistenceSandbox, hasPersistenceSandbox } from './sandboxes.js';

function intOr(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPersistenceConfig() {
  const raw = appConfig.persistenceAgent || {};
  const defaultModel = String(raw.defaultModel || appConfig.ai?.defaultModel || appConfig.ai?.model || '').trim();
  return {
    enabled: raw.enabled !== false && env.PERSISTENCE_AGENT_ENABLED !== false,
    defaultModel,
    temperature: Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : 0.3,
    maxTokens: intOr(raw.maxTokens, appConfig.ai?.maxTokens || 4096),
    topP: Number.isFinite(Number(raw.topP)) ? Number(raw.topP) : 1,
    command: String(raw.command || 'agent').trim().toLowerCase() || 'agent',
    maxRounds: intOr(raw.maxRounds, 40),
    maxRuntimeMinutes: env.PERSISTENCE_MAX_RUNTIME_MINUTES || intOr(raw.maxRuntimeMinutes, 90),
    maxConcurrent: env.PERSISTENCE_MAX_CONCURRENT || intOr(raw.maxConcurrent, 1),
    maxAttempts: intOr(raw.maxAttempts, 3),
    pollIntervalMs: env.PERSISTENCE_POLL_MS || intOr(raw.pollIntervalMs, 4000),
    leaseSeconds: env.PERSISTENCE_LEASE_SECONDS || intOr(raw.leaseSeconds, 90),
    heartbeatMs: intOr(raw.heartbeatMs, 20000),
    workspaceRoot: env.PERSISTENCE_WORKSPACE_ROOT
      || String(raw.workspaceRoot || '/data/home/jen404/agents').trim()
      || '/data/home/jen404/agents',
    idleKeepaliveMinutes: intOr(raw.idleKeepaliveMinutes, 25),
    notifyOnComplete: raw.notifyOnComplete !== false,
    timeoutMs: intOr(raw.timeoutMs, env.AI_TIMEOUT_MS || 60000),
    allow: Array.isArray(raw.allow) && raw.allow.length
      ? raw.allow
      : ['linux_machine', 'sandbox', 'web_search', 'write_file', 'file_storage', 'screenshot'],
  };
}

export function persistenceFeatureEnabled() {
  const config = getPersistenceConfig();
  return Boolean(config.enabled && hasPersistenceSandbox());
}

export function getPersistenceRuntime() {
  const config = getPersistenceConfig();
  const runtime = getAiRuntime(config.defaultModel, { role: 'persistence', tools: true });
  return {
    ...runtime,
    timeoutMs: Math.max(runtime.timeoutMs || 0, config.timeoutMs),
  };
}

export function persistenceSandbox() {
  return getPersistenceSandbox();
}
