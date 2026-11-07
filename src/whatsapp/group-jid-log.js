import { logger } from '../utils/logger.js';
import { isGroupJid } from './filters.js';
import { loadGroupDetails } from './group.js';
import { normalizeGroupJid } from './reelix-gate.js';

const logged = new Set();

function entry(jid, name) {
  return {
    groupJid: normalizeGroupJid(jid) || String(jid || ''),
    groupName: name || null,
  };
}

function rememberAndLog({ groupJid, groupName }) {
  if (!groupJid || logged.has(groupJid)) return false;
  logged.add(groupJid);
  logger.info(
    { groupJid, groupName },
    `WhatsApp group "${groupName || '?'}" jid=${groupJid}`,
  );
  return true;
}

export async function logParticipatingGroups(sock) {
  if (typeof sock?.groupFetchAllParticipating !== 'function') {
    logger.warn('cannot list WhatsApp groups: groupFetchAllParticipating is missing');
    return;
  }

  let groups;
  try {
    groups = await sock.groupFetchAllParticipating();
  } catch (error) {
    logger.warn({ err: error }, 'failed to list WhatsApp groups');
    return;
  }

  const entries = Object.values(groups || {})
    .map((meta) => entry(meta?.id, meta?.subject))
    .filter((item) => item.groupJid);

  logger.info(
    { count: entries.length, groups: entries },
    'WhatsApp groups the bot is in — copy groupJid into REELIX_GROUP_JID',
  );

  for (const item of entries) rememberAndLog(item);
}

export function logGroupMeta(meta) {
  if (!meta?.id) return;
  rememberAndLog(entry(meta.id, meta.subject || meta.name || null));
}

export async function logSeenGroupJid(sock, jid) {
  if (!isGroupJid(jid)) return;
  const groupJid = normalizeGroupJid(jid) || jid;
  if (logged.has(groupJid)) return;

  let name = null;
  try {
    const details = await loadGroupDetails(sock, jid);
    name = details?.name || null;
  } catch (error) {
    logger.debug({ err: error, jid }, 'failed to load group name for jid log');
  }

  rememberAndLog(entry(jid, name));
}
