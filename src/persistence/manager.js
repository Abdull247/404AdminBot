import { appConfig } from '../config/load-config.js';
import { getPersistenceConfig, persistenceFeatureEnabled } from '../config/persistence.js';
import { isGroupJid } from '../whatsapp/filters.js';
import { HOURGLASS, reactToMessage } from '../whatsapp/react.js';
import { captureMessageAttachments } from './files.js';
import { createJobId } from './ids.js';
import { queuedReply, busyReply, jobPublicInfo, formatJobCard, formatJobList, formatLogs, isActiveStatus, clip, statusLabel } from './format.js';
import { parseJobId } from './ids.js';
import {
  insertJob,
  getJobForChat,
  listJobsForChat,
  countActiveJobs,
  listRunningJobs,
  requestCancel,
} from '../db/repositories/persistence/jobs.js';
import { latestSteps } from '../db/repositories/persistence/steps.js';
import { addLog, listLogs } from '../db/repositories/persistence/logs.js';
import { listJobFiles } from '../db/repositories/persistence/files.js';
import { wakePersistenceWorker } from './worker.js';
import { logger } from '../utils/logger.js';

function prefix(jid) {
  if (String(jid || '').startsWith('tg:')) return '/';
  return appConfig.bot.commandPrefix || '.';
}

function commandName() {
  return getPersistenceConfig().command;
}

export function persistenceAvailable() {
  return persistenceFeatureEnabled();
}

export async function createPersistenceJob({
  task,
  context = '',
  maxRuntimeMinutes,
  jid,
  pushName = null,
  sock = null,
  message = null,
}) {
  if (!persistenceAvailable()) {
    return { ok: false, error: 'Persistent agents are disabled. Enable supports_persistence_agent on a sandbox and persistenceAgent.enabled in config.json.' };
  }
  const cleanTask = String(task || '').trim();
  if (!cleanTask) return { ok: false, error: 'task is required' };
  if (!jid) return { ok: false, error: 'no WhatsApp chat context' };

  const config = getPersistenceConfig();
  const running = await listRunningJobs({ limit: Math.max(config.maxConcurrent, 8) });
  if (running.length >= config.maxConcurrent) {
      const instances = running.map((job) => jobPublicInfo(job, { prefix: prefix(jid), command: commandName() }));
    return {
      ok: false,
      busy: true,
      error: running.length === 1
        ? 'A persistent agent is already running.'
        : `${running.length} persistent agents are already running (cap ${config.maxConcurrent}).`,
      cap: config.maxConcurrent,
      runningCount: running.length,
      instances,
      instance: instances[0] || null,
        reply: busyReply(running, { prefix: prefix(jid), command: commandName(), cap: config.maxConcurrent }),
    };
  }

  const active = await countActiveJobs();
  if (active >= config.maxConcurrent * 4) {
    return { ok: false, error: `Too many persistent agents are already queued (${active}). Try again later.` };
  }

  const minutes = Number.parseInt(maxRuntimeMinutes, 10);
  const runtimeMinutes = Number.isFinite(minutes) && minutes > 0
    ? Math.min(minutes, config.maxRuntimeMinutes)
    : config.maxRuntimeMinutes;
  const id = createJobId();

  if (sock && message) {
    await reactToMessage(sock, message, HOURGLASS);
  }

  const job = await insertJob({
    id,
    ownerJid: jid,
    chatJid: jid,
    chatType: String(jid || '').startsWith('tg:')
      ? (String(jid).startsWith('tg:-') ? 'group' : 'dm')
      : (isGroupJid(jid) ? 'group' : 'dm'),
    pushName,
    sourceMessageId: message?.key?.id || null,
    task: cleanTask,
    context: String(context || '').trim() || null,
    status: 'queued',
    progress: 'Queued',
    metadata: {
      source: 'create_agent',
    },
    maxRuntimeSeconds: runtimeMinutes * 60,
  });

  if (sock && message) {
    try {
      await captureMessageAttachments({ sock, message, jobId: id, jid });
    } catch (error) {
      logger.warn({ err: error, jobId: id }, 'failed to capture persistence attachments');
    }
  }

  await addLog({ jobId: id, message: 'job queued', data: { task: cleanTask } });
  logger.info(
    {
      jobId: job.id,
      jid,
      status: job.status,
      maxRuntimeMinutes: runtimeMinutes,
      task: clip(cleanTask, 240),
    },
    'create_agent queued persistence job',
  );
  wakePersistenceWorker();

  return {
    ok: true,
    id: job.id,
    status: job.status,
    maxRuntimeMinutes: runtimeMinutes,
      reply: queuedReply(job, { prefix: prefix(jid), command: commandName() }),
  };
}

export async function inspectJob(jid, rawId) {
  const id = parseJobId(rawId);
  const job = await getJobForChat(id, jid);
  if (!job) return `No persistent agent \`${id}\` in this chat.`;
  const [steps, files] = await Promise.all([
    latestSteps(id, { limit: 8 }),
    listJobFiles(id),
  ]);
  return formatJobCard(job, {
    prefix: prefix(jid),
    command: commandName(),
    steps,
    files,
  });
}

export async function inspectLogs(jid, rawId) {
  const id = parseJobId(rawId);
  const job = await getJobForChat(id, jid);
  if (!job) return `No persistent agent \`${id}\` in this chat.`;
  const logs = await listLogs(id, { limit: 30 });
  return `*Logs for* \`${id}\`\n\n${formatLogs(logs)}`;
}

export async function inspectResult(jid, rawId) {
  const id = parseJobId(rawId);
  const job = await getJobForChat(id, jid);
  if (!job) return `No persistent agent \`${id}\` in this chat.`;
  const prefixValue = prefix(jid);
  const command = commandName();
  logger.info({ jid, jobId: id, status: job.status, hasResult: Boolean(job.result), hasError: Boolean(job.error) }, 'agent result lookup');
  if (isActiveStatus(job.status)) {
    const [steps, files] = await Promise.all([
      latestSteps(id, { limit: 6 }),
      listJobFiles(id),
    ]);
    return [
      `Agent \`${id}\` is still ${statusLabel(job.status).toLowerCase()}. No final result yet.`,
      '',
      formatJobCard(job, { prefix: prefixValue, command, steps, files }),
    ].join('\n');
  }
  if (job.status === 'failed' || job.status === 'timed_out' || job.status === 'cancelled' || job.status === 'interrupted') {
    return [
      `*Result for* \`${id}\``,
      `Status: ${statusLabel(job.status)}`,
      job.progress ? `Progress: ${clip(job.progress, 400)}` : '',
      '',
      job.result || job.error || 'No written result. The job did not finish successfully.',
      '',
      `Logs: ${prefixValue}${command} logs ${id}`,
    ].filter(Boolean).join('\n');
  }
  if (!job.result && !job.error) {
    return formatJobCard(job, { prefix: prefixValue, command });
  }
  return [
    `*Result for* \`${id}\``,
    `Status: ${statusLabel(job.status)}`,
    '',
    job.result || job.error,
  ].join('\n');
}

export async function listChatJobs(jid) {
  const jobs = await listJobsForChat(jid, { limit: 8 });
  return formatJobList(jobs, { prefix: prefix(jid), command: commandName() });
}

export async function cancelChatJob(jid, rawId) {
  const id = parseJobId(rawId);
  const job = await requestCancel(id, jid);
  if (!job) {
    const existing = await getJobForChat(id, jid);
    if (!existing) return `No persistent agent \`${id}\` in this chat.`;
    return `Agent \`${id}\` is already ${existing.status}.`;
  }
  wakePersistenceWorker();
  return `Cancellation requested for \`${id}\`. It will stop after the current step.`;
}

export async function listActiveInstances() {
  const jobs = await listRunningJobs({ limit: 20 });
  return jobs.map((job) => jobPublicInfo(job, { prefix: prefix(job.chat_jid), command: commandName() }));
}
