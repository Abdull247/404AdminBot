import { getChatSettings, setChatPersonality } from '../db/repositories/settings.js';
import { findPersonality, getDefaultPersonality, listPersonalities } from '../personalities/load.js';
import { commandPrefix } from './prefix.js';

function formatList(currentId, context = {}) {
  const lines = ['*Personalities*', ''];
  for (const item of listPersonalities()) {
    const mark = item.id === currentId ? ' (active)' : '';
    lines.push(`- *${item.name}*${mark}`);
    if (item.description) lines.push(`  ${item.description}`);
  }
  lines.push('');
  const prefix = commandPrefix(context);
  lines.push('Switch with:');
  lines.push(`${prefix}personalities - Helpfulness`);
  return lines.join('\n');
}

export async function handlePersonalities({ jid, memoryJid, arg, ...context }) {
  const settingsJid = memoryJid || jid;
  const settings = settingsJid ? await getChatSettings(settingsJid) : null;
  const current = findPersonality(settings?.personality)
    || getDefaultPersonality();

  if (!arg) {
    return formatList(current?.id, context);
  }

  const next = findPersonality(arg);
  if (!next) {
    return `I don't have a personality named "${arg}".\n\n${formatList(current?.id, context)}`;
  }

  if (settingsJid) {
    await setChatPersonality(settingsJid, next.id);
  }

  return `Switched this chat to *${next.name}*.\n${next.description || ''}`.trim();
}
