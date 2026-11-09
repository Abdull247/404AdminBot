export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalizeText(text).split(' ').filter((token) => token.length > 1);
}

function trigrams(text) {
  const padded = ` ${normalizeText(text)} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) {
    grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function diceCoefficient(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) {
    if (b.has(gram)) shared += 1;
  }
  return (2 * shared) / (a.size + b.size);
}

function tokenOverlap(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const textTokens = new Set(tokens(text));
  if (!textTokens.size) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) {
      hits += 1;
      continue;
    }
    for (const candidate of textTokens) {
      if (candidate.startsWith(token) || token.startsWith(candidate)) {
        hits += 0.5;
        break;
      }
    }
  }
  return hits / queryTokens.length;
}

// Fuzzy similarity of a query against a piece of text in [0, 1].
// Blends character trigram dice (typo tolerant), token overlap, and a
// substring bonus so both "almost precise" and guessed queries score well.
export function scoreText(query, text) {
  const normalizedQuery = normalizeText(query);
  const normalizedText = normalizeText(text);
  if (!normalizedQuery || !normalizedText) return 0;
  const dice = diceCoefficient(trigrams(normalizedQuery), trigrams(normalizedText));
  const overlap = tokenOverlap(tokens(normalizedQuery), text);
  const substring = normalizedText.includes(normalizedQuery) ? 1 : 0;
  return Math.min(1, dice * 0.4 + overlap * 0.5 + substring * 0.1);
}

export function rankMemories(query, memories, { limit = 10, minRelevance = 0.05 } = {}) {
  return memories
    .map((memory) => {
      const relevance = scoreText(query, `${memory.key} ${memory.value} ${memory.key}`);
      const importance = Math.min(10, Math.max(1, Number(memory.importance) || 1));
      const score = relevance * 0.85 + (importance / 10) * 0.15;
      return { ...memory, relevance, score };
    })
    .filter((memory) => memory.relevance >= minRelevance)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
