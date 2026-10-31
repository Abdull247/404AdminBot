const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripLoneSurrogates(value) {
  return String(value ?? '').replace(LONE_SURROGATE, '');
}

export function truncateText(value, max) {
  const chars = Array.from(stripLoneSurrogates(String(value ?? '')));
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}...`;
}
