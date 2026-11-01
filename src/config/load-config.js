import fs from 'node:fs';
import { env } from './env.js';

const defaults = {
  ai: {
    defaultModel: 'gpt-4o-mini',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1,
    stream: false,
    systemInstruction: 'You are a helpful WhatsApp assistant.',
    providers: [],
  },
  bot: {
    name: 'Assistant',
    ignoreGroups: true,
    ignoreStatus: true,
    respondToMentionsInGroups: true,
    respondToRepliesInGroups: true,
    respondToNameMentionsInGroups: true,
    deriveNameAliases: true,
    nameAliases: [],
    nameCallPatterns: [],
    reactInGroups: true,
    reactInDms: false,
    typingIndicator: true,
    markMessagesRead: true,
    ownerNumbers: [],
    logGroupMessages: true,
    commandPrefix: '.',
    defaultPersonality: 'helpfulness',
    queue: {
      maxConcurrentChats: 4,
      maxPerChat: 8,
      maxGlobal: 48,
      notifyQueued: true,
    },
    reelixMusic: {
      enabled: true,
      publicAccess: true,
      allowInGroups: true,
      allowStream: true,
      allowStreamInDms: true,
      allowStreamInGroups: true,
      publicStreamEndpoint: true,
      defaultSource: 'audiomack',
    },
  },
  memory: {
    enabled: true,
    maxHistoryMessages: 20,
    maxMemoriesPerUser: 50,
  },
  tools: {
    enabled: true,
    allow: ['write_file', 'web_search', 'get_datetime', 'sandbox', 'linux_machine', 'list_chats', 'summarize_chat', 'react', 'screenshot', 'send_sticker', 'unwrap_view_once', 'generate_image', 'file_storage', 'create_agent'],
    maxRounds: 10,
    handoffAfterRounds: 3,
  },
  persistenceAgent: {
    enabled: true,
    defaultModel: '',
    temperature: 0.3,
    maxTokens: 4096,
    topP: 1,
    command: 'agent',
    maxRounds: 40,
    maxRuntimeMinutes: 90,
    maxConcurrent: 1,
    maxAttempts: 3,
    pollIntervalMs: 4000,
    leaseSeconds: 90,
    heartbeatMs: 20000,
    workspaceRoot: '/data/home/jen404/agents',
    idleKeepaliveMinutes: 25,
    notifyOnComplete: true,
    timeoutMs: 120000,
    allow: ['linux_machine', 'sandbox', 'web_search', 'write_file', 'file_storage', 'screenshot'],
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

export function loadAppConfig() {
  if (!fs.existsSync(env.CONFIG_PATH)) {
    throw new Error(`Config file not found: ${env.CONFIG_PATH}`);
  }

  const raw = fs.readFileSync(env.CONFIG_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const merged = deepMerge(defaults, parsed);
  if (!parsed?.ai?.model && merged.ai?.defaultModel) {
    merged.ai.model = merged.ai.defaultModel;
  }
  if (!merged.ai.defaultModel && merged.ai.model) {
    merged.ai.defaultModel = merged.ai.model;
  }
  return merged;
}

export const appConfig = loadAppConfig();
