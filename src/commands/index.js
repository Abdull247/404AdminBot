import { getPersistenceConfig, persistenceFeatureEnabled } from '../config/persistence.js';
import { platformLinkEnabled } from '../config/platform-link.js';
import { logger } from '../utils/logger.js';
import { handleMenu } from './menu.js';
import { handleModels } from './models.js';
import { parseCommand } from './parse.js';
import { handlePersistence } from './persistence.js';
import { handlePersonalities } from './personalities.js';
import { handleReelix } from './reelix.js';
import { handleUnwrapViewOnce } from './unwrap.js';
import { linkCommandDefinitions } from './platform-link.js';
import { commandPrefix } from './prefix.js';
import { getCommand, listCommands, registerCommand } from './registry.js';

let loaded = false;

function loadCommands() {
  if (loaded) return;
  registerCommand({
    name: 'menu',
    aliases: ['help', 'commands', 'start'],
    usage: '.menu  |  /menu',
    description: 'List all available commands.',
    handler: handleMenu,
  });
  registerCommand({
    name: 'models',
    aliases: ['providers', 'ai', 'llm'],
    usage: '.models  |  /models',
    description: 'Show configured AI providers, models, support flags, and fallback order. Owner only.',
    handler: handleModels,
  });
  registerCommand({
    name: 'personalities',
    aliases: ['personality', 'persona'],
    usage: '.personalities  |  /personalities  |  .personalities - Helpfulness',
    description: 'List AI personalities, or switch this chat to one.',
    handler: handlePersonalities,
  });
  registerCommand({
    name: 'reelix',
    aliases: ['movie', 'movies', 'film'],
    usage: '.reelix <title>  |  /reelix <title>  |  .reelix search <title>  |  .reelix details <id>',
    description: 'Search Reelix movies and series, then show details, cast, or resources.',
    handler: handleReelix,
  });
  registerCommand({
    name: 'unwrap',
    aliases: ['viewonce', 'view-once', 'reveal', 'vv'],
    usage: '.unwrap  |  .unwrap current',
    description: 'Resend a view-once image you replied to (or sent) as a normal photo. WhatsApp only.',
    handler: handleUnwrapViewOnce,
  });
  if (persistenceFeatureEnabled()) {
    const command = getPersistenceConfig().command;
    registerCommand({
      name: command,
      aliases: ['agents', 'persist', 'persistence', 'jobs', 'check'],
      usage: `.${command}  |  /${command}  |  .${command} <id>  |  .${command} logs <id>  |  .${command} result <id>  |  .${command} cancel <id>`,
      description: 'List, inspect, or cancel persistent background agents in this chat.',
      handler: handlePersistence,
    });
  }
  if (platformLinkEnabled()) {
    for (const definition of linkCommandDefinitions()) {
      registerCommand(definition);
    }
  }
  loaded = true;
  logger.info({ commands: listCommands().map((item) => item.name) }, 'commands loaded');
}

export async function tryHandleCommand(context) {
  loadCommands();
  const parsed = parseCommand(context.text);
  if (!parsed) return null;

  const command = getCommand(parsed.name);
  const prefix = parsed.prefix || commandPrefix(context);
  if (!command) {
    return `Unknown command ${prefix}${parsed.name}. Send ${prefix}menu for the list.`;
  }

  return command.handler({
    ...context,
    arg: parsed.arg,
    raw: parsed.raw,
    prefix,
  });
}

export { loadCommands, parseCommand };
