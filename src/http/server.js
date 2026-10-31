import http from 'node:http';
import { env } from '../config/env.js';
import { appConfig } from '../config/load-config.js';
import { persistenceFeatureEnabled } from '../config/persistence.js';
import { persistenceWorkerStatus } from '../persistence/worker.js';
import { logger } from '../utils/logger.js';
import { requestQueueSnapshot } from '../whatsapp/request-queue.js';
import { getConnectionStatus, getCurrentSocket } from '../whatsapp/socket.js';
import { handleMiscStream, logMiscStreamError } from './misc-stream.js';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function healthPayload() {
  const sock = getCurrentSocket();
  return {
    ok: true,
    bot: appConfig.bot.name,
    whatsapp: getConnectionStatus(),
    jid: sock?.user?.id || null,
    uptime: Math.round(process.uptime()),
    persistenceAgent: {
      enabled: persistenceFeatureEnabled(),
      ...persistenceWorkerStatus(),
    },
    requestQueue: requestQueueSnapshot(),
  };
}

export function startHealthServer() {
  if (!env.PORT) return null;

  const server = http.createServer((req, res) => {
    const path = String(req.url || '/').split('?')[0];
    if (req.method === 'GET' && (path === '/' || path === '/health' || path === '/ping')) {
      json(res, 200, healthPayload());
      return;
    }
    if (req.method === 'GET' && path === '/misc/stream') {
      handleMiscStream(req, res).catch((error) => {
        logMiscStreamError(error);
        if (!res.headersSent) json(res, 500, { ok: false, error: 'stream failed' });
      });
      return;
    }
    json(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT }, 'health server listening');
  });

  server.on('error', (error) => {
    logger.error({ err: error }, 'health server failed');
  });

  return server;
}
