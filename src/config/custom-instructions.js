import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const customInstructionsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../custom-instructions.json',
);

const CURATED_ROOT_KEYS = new Set(['bot', 'creator', 'instructions']);
const MAX_DEPTH = 6;
const MAX_RENDER_LENGTH = 20000;

function loadCustomInstructions() {
  try {
    const raw = fs.readFileSync(customInstructionsPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn({ path: customInstructionsPath }, 'custom instructions file not found');
    } else {
      logger.warn({ err: error, path: customInstructionsPath }, 'failed to parse custom instructions file');
    }
    return null;
  }
}

export const customInstructions = loadCustomInstructions();

function text(value) {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  return clean || null;
}

function lowerFirst(value) {
  if (/^(a|an|the) /i.test(value) && !/^[A-Z]{2,}/.test(value)) {
    return value[0].toLowerCase() + value.slice(1);
  }
  return value;
}

function humanizeKey(key) {
  const words = String(key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Details';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitiveList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => !isPlainObject(item) && !Array.isArray(item));
}

function pad(depth) {
  return '  '.repeat(Math.max(depth, 0));
}

function sectionLabel(key, value) {
  if (isPlainObject(value)) {
    const named = text(value.name) || text(value.alias);
    if (named) return named;
  }
  return humanizeKey(key);
}

function indentBullet(label, depth) {
  return `${pad(depth)}- ${label}`;
}

function compactValue(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const CANNED_QUESTION_KEYS = new Set(['admin_questions', 'creator_questions']);

function isSkippedDefault(key, parentKey) {
  return key === 'default' && CANNED_QUESTION_KEYS.has(parentKey);
}

function renderNode(key, value, depth, parentKey, usedLabel) {
  if (value === null || value === undefined || value === '') return [];
  if (isSkippedDefault(key, parentKey)) return [];

  if (isPlainObject(value)) {
    const label = sectionLabel(key, value);
    const children = renderEntries(value, depth + 1, key, label);
    if (!children.length) return [];
    return [indentBullet(label, depth), ...children];
  }

  if (Array.isArray(value)) {
    if (isPrimitiveList(value)) {
      const items = value.map((item) => text(item)).filter(Boolean).map((item) => indentBullet(item, depth + 1));
      if (!items.length) return [];
      return [indentBullet(`${humanizeKey(key)}:`, depth), ...items];
    }
    return [indentBullet(`${humanizeKey(key)}: ${compactValue(value)}`, depth)];
  }

  const content = text(value);
  if (!content) return [];
  if (usedLabel && content === usedLabel) return [];
  return [indentBullet(`${humanizeKey(key)}: ${content}`, depth)];
}

function renderEntries(data, depth, parentKey = '', usedLabel = null) {
  const lines = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (String(key).startsWith('$')) continue;
    if (key === 'instructions' && isPrimitiveList(value)) {
      const rules = value.map((item) => text(item)).filter(Boolean);
      if (!rules.length) continue;
      lines.push(indentBullet('Keep in mind:', depth));
      lines.push(...rules.map((rule) => indentBullet(rule, depth + 1)));
      continue;
    }
    lines.push(...renderNode(key, value, depth, parentKey, usedLabel));
  }
  return lines.filter((line, index, all) => line !== all[index - 1]);
}

function buildCurated(data) {
  const lines = ['Always-on identity and creator instructions, whatever personality is active:'];
  const bot = isPlainObject(data.bot) ? data.bot : {};
  const creator = isPlainObject(data.creator) ? data.creator : {};

  const botName = text(bot.name);
  if (botName) lines.push(`- Your name is ${botName}. Introduce yourself as ${botName} when asked who you are.`);
  const botType = text(bot.type);
  if (botType) lines.push(`- What you are: ${botType}.`);
  const botIdentity = text(bot.identity);
  if (botIdentity) lines.push(`- ${botIdentity}.`);

  const creatorName = text(creator.name);
  if (creatorName) {
    const about = text(creator.about);
    const aboutClean = about ? about.replace(/\.+$/, '') : null;
    lines.push(`- Creator: ${creatorName}${aboutClean ? ` — ${lowerFirst(aboutClean)}` : ''}.`);
  }

  const contacts = [
    text(creator.whatsapp) ? `WhatsApp: ${text(creator.whatsapp)}` : null,
    text(creator.portfolio) ? `Portfolio: ${text(creator.portfolio)}` : null,
    text(creator.github) ? `GitHub: ${text(creator.github)}` : null,
  ].filter(Boolean);
  if (contacts.length) {
    lines.push('- Developer contacts to share when someone asks about the creator:');
    for (const contact of contacts) lines.push(`  - ${contact}`);
  }

  const canned = text(data.response_guidelines?.admin_questions?.default)
    || text(data.response_guidelines?.creator_questions?.default);
  if (canned) {
    lines.push(`- When the boss asks who built, created, or owns you, a good concise answer is: "${canned}"`);
  }

  const rules = Array.isArray(data.instructions) ? data.instructions.map((rule) => text(rule)).filter(Boolean) : [];
  if (rules.length) {
    lines.push('- Permanent rules:');
    for (const rule of rules) lines.push(`  - ${rule}`);
  }

  return lines;
}

function buildRendered(data) {
  const lines = buildCurated(data);
  const knowledge = {};
  for (const [key, value] of Object.entries(data)) {
    if (CURATED_ROOT_KEYS.has(key)) continue;
    if (key === 'response_guidelines' && isPlainObject(value)) {
      const rest = { ...value };
      for (const questionKey of CANNED_QUESTION_KEYS) {
        if (isPlainObject(rest[questionKey]) && 'default' in rest[questionKey]) {
          const { default: _ignored, ...other } = rest[questionKey];
          rest[questionKey] = other;
        }
      }
      knowledge[key] = rest;
      continue;
    }
    knowledge[key] = value;
  }

  const knowledgeLines = renderEntries(knowledge, 0);
  if (knowledgeLines.length) {
    lines.push(
      '',
      'Creator facts, projects, and preferences below are authoritative knowledge. Answer from them accurately, mention only the sections relevant to the conversation, and never invent details that are not here:',
      ...knowledgeLines,
    );
  }

  let rendered = lines.join('\n');
  if (rendered.length > MAX_RENDER_LENGTH) {
    rendered = `${rendered.slice(0, MAX_RENDER_LENGTH)}\n[custom instructions truncated]`;
  }
  return rendered;
}

const cache = { source: null, text: '' };

export function formatCustomInstructions(data = customInstructions) {
  if (!data || typeof data !== 'object') return '';
  if (cache.source === data && cache.text) return cache.text;
  cache.source = data;
  cache.text = buildRendered(data);
  return cache.text;
}
