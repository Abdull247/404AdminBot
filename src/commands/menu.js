import { appConfig } from '../config/load-config.js';
import { commandPrefix } from './prefix.js';
import { listCommands } from './registry.js';

export function menuText(context = {}) {
  const bot = appConfig.bot.name || 'Jen404';
  const prefix = commandPrefix(context);
  const lines = [`*${bot} commands*`, ''];
  for (const command of listCommands()) {
    lines.push(`*${prefix}${command.name}*`);
    if (command.usage) lines.push(`  ${command.usage}`);
    if (command.description) lines.push(`  ${command.description}`);
    lines.push('');
  }
  lines.push('Personality switch example:');
  lines.push(`${prefix}personalities - Helpfulness`);
  lines.push('');
  lines.push('WhatsApp uses `.` commands. Telegram uses `/` commands.');
  return lines.join('\n').trim();
}

export async function handleMenu(context = {}) {
  return menuText(context);
}
