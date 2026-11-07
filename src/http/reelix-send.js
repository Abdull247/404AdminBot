import { logger } from '../utils/logger.js';
import { authorizeSend, readJsonBody, sendKeyConfigured } from './auth.js';
import { sendReelixGroupMessage } from '../reelix/notify.js';
import { reelixGroupJid, restrictAccessEnabled } from '../whatsapp/reelix-gate.js';

export async function handleReelixSend(req, res, json) {
  const auth = authorizeSend(req);
  if (!auth.ok) {
    json(res, auth.status, { ok: false, error: auth.error });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    json(res, error.status || 400, { ok: false, error: error.message || 'invalid body' });
    return;
  }

  const result = await sendReelixGroupMessage(body);
  json(res, result.ok ? 200 : (result.status || 502), result);
}

export function reelixHealthExtras() {
  return {
    reelix: {
      groupJid: reelixGroupJid() || null,
      restrictAccess: restrictAccessEnabled(),
      sendKeyConfigured: sendKeyConfigured(),
    },
  };
}

export function logReelixSendError(error) {
  logger.error({ err: error }, 'reelix send endpoint failed');
}
