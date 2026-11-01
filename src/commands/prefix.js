import { appConfig } from '../config/load-config.js';
import { telegramCommandPrefix } from '../config/telegram.js';
import { TELEGRAM } from '../platforms/ids.js';

export function platformFromContext(context = {}) {
  if (context.platform) return context.platform;
  if (context.sock?.platform === TELEGRAM) return TELEGRAM;
  if (String(context.nativeJid || context.jid || '').startsWith('tg:')) return TELEGRAM;
  return 'whatsapp';
}

export function commandPrefix(context = {}) {
  if (platformFromContext(context) === TELEGRAM) return telegramCommandPrefix();
  return appConfig.bot.commandPrefix || '.';
}

export function withPrefix(name, context = {}) {
  return `${commandPrefix(context)}${name}`;
}
