import { describeCatalog, getAiRuntime, listFallbackChain, resolveRoleMatch } from '../config/providers.js';
import { getPersistenceConfig } from '../config/persistence.js';
import { isOwnerJid } from '../whatsapp/owner.js';
import { isTelegramOwner } from '../telegram/owner.js';
import { commandPrefix } from './prefix.js';

function isOwner(context) {
  if (context?.platform === 'telegram' || context?.sock?.platform === 'telegram') {
    return isTelegramOwner(context.message);
  }
  return isOwnerJid(context.jid, context.sock);
}

function flag(value) {
  return value ? 'on' : 'off';
}

function formatSupport(support = {}) {
  return [
    `chat=${flag(support.chat !== false)}`,
    `tools=${flag(support.tools !== false)}`,
    `vision=${flag(Boolean(support.vision))}`,
    `persistence=${flag(Boolean(support.persistence))}`,
    `json=${flag(Boolean(support.json))}`,
  ].join(' ');
}

export function modelsText(context = {}) {
  const catalog = describeCatalog();
  let chat = null;
  try {
    chat = getAiRuntime(undefined, { role: 'chat' });
  } catch {
    chat = null;
  }
  const persistence = getPersistenceConfig();
  const persistMatch = resolveRoleMatch('persistence', persistence.defaultModel);
  const prefix = commandPrefix(context);
  const lines = [
    '*AI providers*',
    `Default provider: ${catalog.defaultProvider || chat?.providerId || 'none'}`,
    `Chat: ${chat ? `${chat.providerId}/${chat.modelId}` : 'unresolved'}`,
    persistMatch
      ? `Persistence: ${persistMatch.provider.id}/${persistMatch.model.id}`
      : `Persistence: ${persistence.defaultModel || chat.modelId}`,
    `Fallback: ${catalog.fallback.enabled ? 'on' : 'off'} (max ${catalog.fallback.maxAttempts})`,
    '',
  ];

  for (const provider of catalog.providers) {
    const mark = provider.default ? ' (default)' : '';
    const ready = provider.ready ? '' : ' key missing';
    lines.push(`*${provider.name}* \`${provider.id}\`${mark}${provider.enabled ? '' : ' [off]'}${ready}`);
    for (const model of provider.models) {
      const bits = [
        model.enabled ? 'on' : 'off',
        `fallback=${flag(model.supportFallback)}`,
      ];
      if (model.default) bits.push('default');
      if (model.roles?.length) bits.push(model.roles.join(','));
      lines.push(`  - ${model.id}`);
      lines.push(`    ${bits.join(' | ')}`);
      lines.push(`    ${formatSupport(model.support)}`);
    }
    lines.push('');
  }

  const chain = listFallbackChain({
    start: resolveRoleMatch('chat'),
    needs: { role: 'chat' },
  }).slice(0, 8);
  if (chain.length) {
    lines.push('*Fallback order (chat)*');
    for (const item of chain) {
      lines.push(`  ${item.runtime.providerId}/${item.runtime.modelId} (${item.reason})`);
    }
    lines.push('');
  }
  lines.push(`Owner-only. Send ${prefix}models again after editing providers/.`);
  return lines.join('\n').trim();
}

export async function handleModels(context = {}) {
  if (!isOwner(context)) {
    return 'Only the bot owner can inspect the model catalog.';
  }
  return modelsText(context);
}
