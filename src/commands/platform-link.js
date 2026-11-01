import { platformLinkConfig, platformLinkEnabled } from '../config/platform-link.js';
import {
  claimLinkCode,
  createLinkOffer,
  linkStatus,
  unlinkCurrent,
} from '../platforms/link.js';
import { TELEGRAM, WHATSAPP } from '../platforms/ids.js';

function platformFromContext(context = {}) {
  if (context.platform) return context.platform;
  if (context.sock?.platform === TELEGRAM) return TELEGRAM;
  if (String(context.nativeJid || context.jid || '').startsWith('tg:')) return TELEGRAM;
  return WHATSAPP;
}

function nativeJidFrom(context, platform) {
  if (context.nativeJid) return context.nativeJid;
  if (platform === TELEGRAM && context.sock?.telegramChatId) {
    const chatId = context.sock.telegramChatId(context.jid);
    if (chatId) return `tg:${chatId}`;
  }
  return context.jid;
}

function groupFrom(context) {
  return Boolean(context.environment?.isGroup);
}

export async function handleLinkPlatform(context) {
  if (!platformLinkEnabled()) {
    return 'Platform linking is off. Enable it in platform-link.json.';
  }
  const platform = platformFromContext(context);
  const jid = nativeJidFrom(context, platform);
  const group = groupFrom(context);
  const arg = String(context.arg || '').trim();
  const userId = platform === TELEGRAM
    ? context.message?.telegram?.from?.id || context.message?.key?.participant
    : context.jid;
  const chatId = platform === TELEGRAM
    ? context.message?.telegram?.chat?.id
    : null;

  if (arg) {
    const claimed = await claimLinkCode({
      platform,
      jid,
      userId,
      name: context.pushName,
      chatId,
      group,
      code: arg,
    });
    return claimed.text || claimed.error;
  }

  const offer = await createLinkOffer({
    platform,
    jid,
    userId,
    name: context.pushName,
    group,
  });
  return offer.text || offer.error;
}

export async function handleUnlinkPlatform(context) {
  const platform = platformFromContext(context);
  const jid = nativeJidFrom(context, platform);
  const result = await unlinkCurrent({
    platform,
    jid,
    group: groupFrom(context),
  });
  return result.text || result.error;
}

export async function handleLinkStatus(context) {
  const platform = platformFromContext(context);
  const jid = nativeJidFrom(context, platform);
  return linkStatus({ platform, jid });
}

export function linkCommandDefinitions() {
  const command = platformLinkConfig.command || 'link-platform';
  const unlink = platformLinkConfig.unlinkCommand || 'unlink-platform';
  const status = platformLinkConfig.statusCommand || 'link-status';
  return [
    {
      name: command,
      aliases: platformLinkConfig.aliases || [],
      usage: `.${command}  |  /${command}  |  .${command} <code>  |  /${command} <code>`,
      description: 'Create a one-time WhatsApp/Telegram link code, or consume a code from the other platform.',
      handler: handleLinkPlatform,
    },
    {
      name: unlink,
      aliases: platformLinkConfig.unlinkAliases || [],
      usage: `.${unlink}  |  /${unlink}`,
      description: 'Disconnect this chat from the other platform.',
      handler: handleUnlinkPlatform,
    },
    {
      name: status,
      aliases: platformLinkConfig.statusAliases || [],
      usage: `.${status}  |  /${status}`,
      description: 'Show whether this chat is linked, and when the session expires.',
      handler: handleLinkStatus,
    },
  ];
}
