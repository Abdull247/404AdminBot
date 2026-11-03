import { createChatCompletion } from '../../../ai/client.js';
import { findChats, getChat } from '../../../db/repositories/chats.js';
import { countMessages, getRecentMessages, searchMessages } from '../../../db/repositories/conversations.js';
import { logger } from '../../../utils/logger.js';
import { isGroupJid } from '../../../whatsapp/filters.js';
import { isOwnerJid } from '../../../whatsapp/owner.js';
import { resolveChatName } from '../../../whatsapp/log-message.js';
import { getCurrentSocket } from '../../../whatsapp/socket.js';

function clampLimit(value, fallback) {
  const limit = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(200, Math.max(10, limit));
}

function clip(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function speakerOf(row) {
  const meta = row.metadata || {};
  if (row.role === 'assistant') return 'Jen404';
  if (meta.fromMe) return meta.pushName || 'You';
  return meta.pushName || meta.participant || (row.role === 'user' ? 'Someone' : row.role);
}

function formatLine(row) {
  const when = row.created_at ? new Date(row.created_at).toISOString().replace('T', ' ').slice(0, 16) : '';
  return `[${when}] ${speakerOf(row)}: ${clip(row.content, 500)}`;
}

function localFacts(rows) {
  const speakers = new Map();
  for (const row of rows) {
    const name = speakerOf(row);
    speakers.set(name, (speakers.get(name) || 0) + 1);
  }
  return {
    speakers: [...speakers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name, messages]) => ({ name, messages })),
    firstAt: rows[0]?.created_at || null,
    lastAt: rows[rows.length - 1]?.created_at || null,
  };
}

async function resolveChat(query) {
  const needle = String(query || '').trim();
  if (!needle) return null;
  const exact = await getChat(needle);
  if (exact) return exact;
  const matches = await findChats(needle, 5);
  if (!matches.length) return null;
  const named = matches.find((chat) => String(chat.name || '').toLowerCase() === needle.toLowerCase());
  return named || matches[0];
}

function parseSummary(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch {
    // fall through
  }
  return {
    summary: text,
    facts: [],
    decisions: [],
    actionItems: [],
    people: [],
  };
}

async function aiSummarize({ chat, lines, focus, facts }) {
  const prompt = [
    `Chat name: ${chat.name || chat.jid}`,
    `Type: ${chat.type}`,
    `Window: ${facts.firstAt || 'unknown'} to ${facts.lastAt || 'unknown'}`,
    focus ? `Focus: ${focus}` : 'Focus: overall recap',
    '',
    'Transcript:',
    lines.join('\n'),
  ].join('\n');

  const completion = await createChatCompletion({
    role: 'summarize',
    messages: [
      {
        role: 'system',
        content: 'You summarize WhatsApp chats. Return ONLY compact JSON with keys: summary (2-6 sentences), facts (array of short factual strings), decisions (array), actionItems (array of {who, what, when}), people (array of names). Do not invent. If something is unclear, omit it. Keep arrays short.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = completion?.choices?.[0]?.message?.content;
  return parseSummary(typeof content === 'string' ? content : '');
}

export async function handler(args = {}, context = {}, options = {}) {
  if (!isOwnerJid(context.jid, context.sock)) {
    return { ok: false, error: 'summarize_chat is only available to the bot owner in a direct chat.' };
  }

  const query = String(args.chat || args.query || args.jid || '').trim();
  if (!query) return { ok: false, error: 'chat is required. Call list_chats first if you need names.' };

  const chat = await resolveChat(query);
  if (!chat) {
    return {
      ok: false,
      error: `No logged chat matched "${query}". Call list_chats, then retry with an exact name or jid.`,
    };
  }

  const sock = context.sock || getCurrentSocket();
  if (!chat.name && sock) {
    const name = await resolveChatName(sock, chat.jid);
    if (name) chat.name = name;
  }

  const limit = clampLimit(args.limit, options.limit || 80);
  const focus = String(args.focus || '').trim();
  const rows = focus
    ? await searchMessages(chat.jid, focus, limit)
    : await getRecentMessages(chat.jid, limit);

  if (!rows.length) {
    return {
      ok: false,
      jid: chat.jid,
      name: chat.name || chat.jid,
      error: 'This chat is listed but has no stored messages yet.',
    };
  }

  const facts = localFacts(rows);
  const lines = rows.map(formatLine);
  const total = await countMessages(chat.jid);

  let analysis = null;
  try {
    analysis = await aiSummarize({ chat, lines, focus, facts });
  } catch (error) {
    logger.warn({ err: error, jid: chat.jid }, 'chat summary model call failed');
  }

  return {
    ok: true,
    jid: chat.jid,
    name: chat.name || chat.jid,
    type: chat.type || (isGroupJid(chat.jid) ? 'group' : 'dm'),
    focus: focus || null,
    storedMessages: total,
    included: rows.length,
    window: {
      firstAt: facts.firstAt,
      lastAt: facts.lastAt,
    },
    speakers: facts.speakers,
    summary: analysis?.summary || clip(lines.slice(-8).join('\n'), 1200),
    facts: analysis?.facts || [],
    decisions: analysis?.decisions || [],
    actionItems: analysis?.actionItems || [],
    people: analysis?.people || facts.speakers.map((item) => item.name),
    excerpt: lines.slice(-12),
  };
}
