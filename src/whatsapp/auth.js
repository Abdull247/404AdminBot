import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { createAuthState } from './auth-state.js';
import { logGroupMeta, logParticipatingGroups } from './group-jid-log.js';
import { reelixChannelEnabled, resolveReelixChannelJid } from './reelix-gate.js';
import { setConnectionStatus, setCurrentSocket } from './socket.js';

let reconnecting = false;
let pairingRequested = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPairingCode(code) {
  const compact = String(code || '').replace(/\s+/g, '').toUpperCase();
  if (compact.length === 8) {
    return `${compact.slice(0, 4)}-${compact.slice(4)}`;
  }
  return compact;
}

async function requestPairingCode(sock) {
  if (sock.authState.creds.registered) return;
  if (!env.WHATSAPP_USE_PAIRING_CODE) return;
  if (pairingRequested) return;
  if (!env.WHATSAPP_PHONE_NUMBER) {
    throw new Error('WHATSAPP_PHONE_NUMBER is required when WHATSAPP_USE_PAIRING_CODE=true');
  }

  pairingRequested = true;
  try {
    await delay(1500);
    const code = await sock.requestPairingCode(env.WHATSAPP_PHONE_NUMBER);
    logger.info(
      { phone: env.WHATSAPP_PHONE_NUMBER, code: formatPairingCode(code) },
      'WhatsApp pairing code ready. On your phone: Linked Devices > Link with phone number',
    );
    return;
  } catch (error) {
    pairingRequested = false;
    throw error;
  }
}

export async function createWhatsAppSocket({ onMessage }) {
  const { state, saveCreds } = await createAuthState();
  const { version } = await fetchLatestBaileysVersion();

  const baileysLogger = logger.child({ module: 'baileys' });
  baileysLogger.level = 'warn';

  const usePairingCode = env.WHATSAPP_USE_PAIRING_CODE && !state.creds.registered;

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  setCurrentSocket(sock);
  setConnectionStatus('connecting');
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !usePairingCode && env.WHATSAPP_PRINT_QR) {
      logger.info('scan this QR code to link WhatsApp');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'connecting') {
      setConnectionStatus('connecting');
      if (usePairingCode) {
        try {
          await requestPairingCode(sock);
        } catch (error) {
          logger.error({ err: error }, 'failed to request WhatsApp pairing code');
        }
      }
    }

    if (connection === 'open') {
      reconnecting = false;
      setConnectionStatus('open');
      logger.info(
        { jid: sock.user?.id, lid: sock.user?.lid || null },
        'WhatsApp connected (lid is required to detect mentions/replies in some groups)',
      );
      logParticipatingGroups(sock).catch((error) => {
        logger.warn({ err: error }, 'failed to log WhatsApp group jids');
      });
      if (reelixChannelEnabled()) {
        resolveReelixChannelJid(sock).catch((error) => {
          logger.warn({ err: error }, 'failed to resolve Reelix channel jid');
        });
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      pairingRequested = false;
      setConnectionStatus(shouldReconnect ? 'reconnecting' : 'logged_out');
      logger.warn({ statusCode, shouldReconnect }, 'WhatsApp disconnected');

      if (shouldReconnect && !reconnecting) {
        reconnecting = true;
        await delay(2000);
        createWhatsAppSocket({ onMessage })
          .catch((error) => {
            logger.error({ err: error }, 'failed to reconnect WhatsApp');
          })
          .finally(() => {
            reconnecting = false;
          });
      } else if (!shouldReconnect) {
        logger.error('WhatsApp session logged out. Delete the session folder and link again.');
      }
    }
  });

  sock.ev.on('groups.upsert', (groups) => {
    for (const meta of groups || []) logGroupMeta(meta);
  });

  sock.ev.on('groups.update', (groups) => {
    for (const meta of groups || []) logGroupMeta(meta);
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const message of messages || []) {
      Promise.resolve(onMessage(sock, message)).catch((error) => {
        logger.error({ err: error }, 'failed to handle incoming message');
      });
    }
  });

  if (usePairingCode) {
    try {
      await requestPairingCode(sock);
    } catch (error) {
      logger.error({ err: error }, 'failed to request WhatsApp pairing code');
    }
  }

  return sock;
}
