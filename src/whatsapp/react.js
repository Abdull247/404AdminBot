import { logger } from '../utils/logger.js';

export const HOURGLASS = '\u231B';
export const CHECK = '\u2705';
export const IMAGE_DONE = '\u{1F5BC}\uFE0F';
export const POPCORN = '\u{1F37F}';
export const FOLDER = '\u{1F4C2}';
export const CROSS = '\u274C';

export const BUSY_REACTIONS = new Set([HOURGLASS, CHECK, POPCORN]);

export function normalizeEmoji(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const segments = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)]
      .map((item) => item.segment)
      .filter((item) => item.trim());
    return segments[0] || '';
  } catch {
    return Array.from(text).join('').trim().slice(0, 8);
  }
}

const LAUGH = '\u{1F602}';
const FOLDED = '\u{1F64F}';
const PARTY = '\u{1F389}';
const SUN = '\u2600\uFE0F';
const MOON = '\u{1F319}';
const WAVE = '\u{1F44B}';
const HEART = '\u2764\uFE0F';
const FIRE = '\u{1F525}';
const WOW = '\u{1F62E}';
const SAD = '\u{1F622}';
const THINK = '\u{1F914}';
const UP = '\u{1F44D}';

const REACTION_RULES = [
  { re: /\b(lmaoo+|lmfao+|rofl|lmao|lol+|haha+|hehe+|funny|joke|hilarious)\b|\u{1F602}|\u{1F923}|\u{1F480}|\u{1F62D}/u, emoji: LAUGH },
  { re: /\b(thanks|thank you|thx|appreciate)\b/i, emoji: FOLDED },
  { re: /\b(congrats|congratulations|well done)\b/i, emoji: PARTY },
  { re: /\b(good morning|gm)\b/i, emoji: SUN },
  { re: /\b(good night|gn)\b/i, emoji: MOON },
  { re: /^(hi|hii+|hello|hey|yo|hiya)\b/i, emoji: WAVE },
  { re: /\b(love (you|this|it)|ily)\b|\u2764|\u{1F60D}/u, emoji: HEART },
  { re: /\b(fire|lit|dope|goat|too good)\b|\u{1F525}/u, emoji: FIRE },
  { re: /\b(wow|omg|whoa)\b/i, emoji: WOW },
  { re: /\b(sad|sorry|miss you)\b/i, emoji: SAD },
  { re: /\b(please help|how do i|what does)\b/i, emoji: THINK },
  { re: /^(ok|okay|bet|sure|alright|got it)[.!]*$/i, emoji: UP },
];

export function pickGroupReaction(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  for (const rule of REACTION_RULES) {
    if (rule.re.test(value)) return rule.emoji;
  }
  return '';
}

export async function reactToMessage(sock, message, emoji) {
  const text = normalizeEmoji(emoji);
  if (!sock || !message?.key || !text) return false;
  const jid = message.key.remoteJid;
  if (!jid) return false;
  try {
    await sock.sendMessage(jid, {
      react: {
        text,
        key: message.key,
      },
    });
    return true;
  } catch (error) {
    logger.warn({ err: error, jid, emoji: text }, 'failed to react to message');
    return false;
  }
}

export async function removeReaction(sock, message) {
  if (!sock || !message?.key) return false;
  const jid = message.key.remoteJid;
  if (!jid) return false;
  try {
    await sock.sendMessage(jid, {
      react: {
        text: '',
        key: message.key,
      },
    });
    return true;
  } catch (error) {
    logger.warn({ err: error, jid }, 'failed to remove reaction');
    return false;
  }
}
