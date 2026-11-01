import { telegramConfig, telegramEnabled } from '../config/telegram.js';
import { logger } from '../utils/logger.js';
import { getMe, getUpdates } from './client.js';
import { handleTelegramUpdate } from './message-handler.js';
import { setTelegramBot, setTelegramStatus } from './socket.js';

let stopped = false;
let offset = 0;

export async function startTelegramPolling() {
  if (!telegramEnabled()) {
    logger.info('telegram disabled; skip polling');
    setTelegramStatus('disabled');
    return null;
  }

  let bot;
  try {
    bot = await getMe();
    setTelegramBot(bot);
    setTelegramStatus('connected');
    logger.info(
      { id: bot.id, username: bot.username, name: bot.first_name },
      'telegram bot connected',
    );
  } catch (error) {
    setTelegramStatus('error');
    logger.error({ err: error }, 'failed to connect telegram bot');
    return null;
  }

  stopped = false;
  (async function loop() {
    while (!stopped) {
      try {
        const updates = await getUpdates({
          offset,
          timeout: telegramConfig.polling.timeoutSeconds,
          limit: telegramConfig.polling.limit,
        });
        for (const update of updates) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          try {
            await handleTelegramUpdate(bot, update);
          } catch (error) {
            logger.error({ err: error, updateId: update.update_id }, 'telegram update failed');
          }
        }
      } catch (error) {
        logger.warn({ err: error }, 'telegram polling error');
        setTelegramStatus('retrying');
        await new Promise((resolve) => setTimeout(resolve, telegramConfig.polling.retryMs || 4000));
      }
    }
  }());

  return bot;
}

export function stopTelegramPolling() {
  stopped = true;
  setTelegramStatus('stopped');
}
