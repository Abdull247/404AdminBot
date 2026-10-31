export function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function normalizePhone(value) {
  return digits(value);
}

export function phoneFromJid(jid) {
  return digits(String(jid || '').split('@')[0].split(':')[0]);
}

export function samePhone(left, right) {
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export function phoneFromMessage(message = {}) {
  const key = message.key || {};
  const pnJid = key.senderPn || key.participantPn || null;
  const lidJid = key.senderLid || key.participantLid || null;
  const remoteJid = key.remoteJid || null;
  const isLid = typeof remoteJid === 'string' && remoteJid.endsWith('@lid');
  const pn = pnJid
    ? digits(String(pnJid).split('@')[0])
    : (isLid ? '' : phoneFromJid(remoteJid));

  return {
    pn: pn || null,
    lid: lidJid ? digits(String(lidJid).split('@')[0]) : (isLid ? phoneFromJid(remoteJid) : null),
    jid: remoteJid,
  };
}
