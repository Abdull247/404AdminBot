import { appConfig } from '../config/load-config.js';
import { telegramCommandPrefix } from '../config/telegram.js';

function prefixes() {
  return [...new Set([
    appConfig.bot.commandPrefix || '.',
    telegramCommandPrefix() || '/',
    '.',
    '/',
  ].filter(Boolean))];
}

function stripBotSuffix(name) {
  return String(name || '').replace(/@[A-Za-z0-9_]+$/, '');
}

export function parseCommand(text) {
  const raw = String(text || '').trim();
  let normalized = raw.replace(/^(?:@\S+\s+)+/, '').trim();
  normalized = normalized.replace(/^\/([A-Za-z][\w-]*)@[A-Za-z0-9_]+/, '/$1');
  const prefix = prefixes().find((item) => normalized.startsWith(item));
  if (!prefix || normalized.length <= prefix.length) return null;

  const body = normalized.slice(prefix.length).trim();
  if (!body) return null;

  const dash = body.match(/^([A-Za-z][\w-]*)\s+-\s+(.+)$/);
  if (dash) {
    return {
      name: stripBotSuffix(dash[1]).toLowerCase(),
      arg: dash[2].trim(),
      raw,
      prefix,
    };
  }

  const colon = body.match(/^([A-Za-z][\w-]*)\s*:\s*(.+)$/);
  if (colon) {
    return {
      name: stripBotSuffix(colon[1]).toLowerCase(),
      arg: colon[2].trim(),
      raw,
      prefix,
    };
  }

  const parts = body.split(/\s+/);
  const name = stripBotSuffix(parts.shift()).toLowerCase();
  const arg = parts.join(' ').trim();
  return { name, arg: arg || '', raw, prefix };
}
