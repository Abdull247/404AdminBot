import { enqueueNotification, listPendingNotifications, markNotificationFailed, markNotificationSent } from '../db/repositories/persistence/notifications.js';
import { getJob, updateJob } from '../db/repositories/persistence/jobs.js';
import { getCurrentSocket } from '../whatsapp/socket.js';
import { sendArtifacts } from '../whatsapp/send.js';
import { toWhatsAppText } from '../whatsapp/markdown.js';
import { sendTelegramArtifacts, sendTelegramText } from '../telegram/send.js';
import { completionReply } from './format.js';
import { logger } from '../utils/logger.js';
import { isTelegramJid } from '../platforms/ids.js';

export async function queueJobNotification(job, event) {
  await enqueueNotification({
    jobId: job.id,
    event,
    payload: completionReply(job),
  });
  await updateJob(job.id, { notifyStatus: 'queued' });
}

export async function flushNotifications() {
  const pending = await listPendingNotifications({ limit: 8 });
  let sent = 0;
  for (const item of pending) {
    const job = await getJob(item.job_id);
    if (!job) {
      await markNotificationFailed(item.id, 'job missing');
      continue;
    }
    const text = item.payload || completionReply(job);
    const telegram = isTelegramJid(job.chat_jid);
    const sock = telegram ? null : getCurrentSocket();
    if (!telegram && !sock) continue;
    try {
      const files = Array.isArray(job.metadata?.artifacts) ? job.metadata.artifacts.map((file) => ({ ...file, ok: true, attachment: true })) : [];
      if (telegram) {
        if (files.length) await sendTelegramArtifacts(job.chat_jid, files);
        await sendTelegramText(job.chat_jid, text);
      } else {
        if (files.length) await sendArtifacts(sock, job.chat_jid, files);
        await sock.sendMessage(job.chat_jid, { text: toWhatsAppText(text) || text });
      }
      await markNotificationSent(item.id);
      await updateJob(job.id, { notifyStatus: 'sent' });
      sent += 1;
    } catch (error) {
      logger.warn({ err: error, jobId: job.id }, 'failed to send persistence notification');
      await markNotificationFailed(item.id, error.message);
    }
  }
  return sent;
}
