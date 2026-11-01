import { appConfig } from '../config/load-config.js';

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUFFIX_WORDS = new Set(['bot', 'ai', 'assistant']);

function segments(value) {
  return String(value || '').match(/[a-z]+|\d+/gi) || [];
}

function normalized(value) {
  return segments(value).join(' ').toLowerCase();
}

function addVariant(set, value) {
  const variant = normalized(value);
  if (variant) set.add(variant);
}

function nameVariants(name) {
  const variants = new Set();
  const base = String(name || '').trim();
  if (!base) return [];

  addVariant(variants, base);
  addVariant(variants, base.replace(/\s+/g, ''));

  const lower = base.toLowerCase();
  for (const suffix of ['bot', 'ai', 'assistant']) {
    addVariant(variants, `${lower}${suffix}`);
    addVariant(variants, `${lower} ${suffix}`);
  }

  if (appConfig.bot.deriveNameAliases === false) return [...variants];

  const parts = segments(lower);
  if (parts.length > 1) {
    for (const part of parts) {
      if (/^\d+$/.test(part)) {
        if (part.length >= 2) {
          addVariant(variants, part);
          addVariant(variants, `${part}bot`);
          addVariant(variants, `${part} bot`);
        }
      } else if (part.length >= 3 && !SUFFIX_WORDS.has(part)) {
        addVariant(variants, part);
      }
    }
    return [...variants];
  }

  const glued = parts[0]?.match(/^([a-z]+)(\d+)$/i);
  if (glued) {
    if (glued[1].length >= 3) addVariant(variants, glued[1]);
    if (glued[2].length >= 2) {
      addVariant(variants, glued[2]);
      addVariant(variants, `${glued[2]}bot`);
      addVariant(variants, `${glued[2]} bot`);
    }
  }

  return [...variants];
}

function variantPattern(variant) {
  const parts = variant.split(' ').filter(Boolean);
  if (!parts.length) return null;
  const body = parts.map(escapeRegExp).join('[\\s._-]*');
  try {
    return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
  } catch {
    return null;
  }
}

function customPatterns() {
  const patterns = Array.isArray(appConfig.bot.nameCallPatterns) ? appConfig.bot.nameCallPatterns : [];
  const compiled = [];
  for (const source of patterns) {
    if (!source) continue;
    try {
      compiled.push(new RegExp(String(source), 'i'));
    } catch {
      // ignore invalid user pattern
    }
  }
  return compiled;
}

export function isBotCalledByName(text, { extraNames = [] } = {}) {
  if (appConfig.bot.respondToNameMentionsInGroups === false) return false;

  const value = String(text || '').trim();
  if (!value) return false;

  for (const pattern of customPatterns()) {
    if (pattern.test(value)) return true;
  }

  const names = [
    appConfig.bot.name,
    ...(Array.isArray(appConfig.bot.nameAliases) ? appConfig.bot.nameAliases : []),
    ...(Array.isArray(extraNames) ? extraNames : []),
  ];

  const seen = new Set();
  for (const name of names) {
    for (const variant of nameVariants(name)) {
      if (seen.has(variant)) continue;
      seen.add(variant);
      const pattern = variantPattern(variant);
      if (pattern && pattern.test(value)) return true;
    }
  }

  return false;
}