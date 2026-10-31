const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripLoneSurrogates(value) {
  return String(value ?? '').replace(LONE_SURROGATE, '');
}

export function stripLoneSurrogatesDeep(value) {
  if (typeof value === 'string') return stripLoneSurrogates(value);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(stripLoneSurrogatesDeep);
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    out[stripLoneSurrogates(key)] = stripLoneSurrogatesDeep(nested);
  }
  return out;
}

export function jsonSafe(value) {
  return JSON.stringify(stripLoneSurrogatesDeep(value));
}

export function truncateText(value, max) {
  const chars = Array.from(stripLoneSurrogates(String(value ?? '')));
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}...`;
}
