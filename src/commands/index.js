import { getPersistenceConfig, persistenceFeatureEnabled } from '../config/persistence.js';
import { logger } from '../utils/logger.js';
import { handleMenu } from './menu.js';
import { parseCommand } from './parse.js';
import { handlePersistence } from './persistence.js';
import { handlePersonalities } from './personalities.js';
import { handleReelix } from './reelix.js';
import { getCommand, listCommands, registerCommand } from './registry.js';

let loaded = false;

function loadCommands() {
  if (loaded) return;
  registerCommand({
    name: 'menu',
    aliases: ['help', 'commands'],
    usage: '.menu',
    description: 'List all available commands.',
    handler: handleMenu,
  });
  registerCommand({
    name: 'personalities',
    aliases: ['personality', 'persona'],
    usage: '.personalities  |  .personalities - Helpfulness',
    description: 'List AI personalities, or switch this chat to one.',
    handler: handlePersonalities,
  });
  registerCommand({
    name: 'reelix',
    aliases: ['movie', 'movies', 'film'],
    usage: '.reelix <title>  |  .reelix search <title>  |  .reelix details <id>',
    description: 'Search Reelix movies and series, then show details, cast, or resources.',
    handler: handleReelix,
  });
  if (persistenceFeatureEnabled()) {
    const command = getPersistenceConfig().command;
    registerCommand({
      name: command,
      aliases: ['agents', 'persist', 'persistence', 'jobs', 'check'],
      usage: `.${command}  |  .${command} <id>  |  .${command} logs <id>  |  .${command} result <id>  |  .${command} cancel <id>`,
      description: 'List, inspect, or cancel persistent background agents in this chat.',
      handler: handlePersistence,
    });
  }
  loaded = true;
  logger.info({ commands: listCommands().map((item) => item.name) }, 'commands loaded');
}

export async function tryHandleCommand({ text, jid, pushName, sock, message, environment }) {
  loadCommands();
  const parsed = parseCommand(text);
  if (!parsed) return null;

  const command = getCommand(parsed.name);
  if (!command) {
    return `Unknown command .${parsed.name}. Send .menu for the list.`;
  }

  return command.handler({
    jid,
    pushName,
    sock,
    message,
    environment,
    arg: parsed.arg,
    raw: parsed.raw,
  });
}

export { loadCommands, parseCommand };
