import { getPersistenceConfig, getPersistenceRuntime, persistenceSandbox } from '../config/persistence.js';
import { createChatCompletion } from '../ai/client.js';
import { extractText, getToolCalls } from '../ai/tool-calls.js';
import { executeToolCall } from '../tools/executor.js';
import { addLog } from '../db/repositories/persistence/logs.js';
import { addStep } from '../db/repositories/persistence/steps.js';
import { listJobMemories } from '../db/repositories/persistence/memories.js';
import { heartbeatJob, updateJob } from '../db/repositories/persistence/jobs.js';
import { loadPersistenceTools, runPersistenceTool } from './tools.js';
import { persistenceSystemPrompt } from './instructions.js';
import { ensureJobWorkspace, getJobMachine, syncAttachmentsToWorkspace, touchHeartbeat } from './workspace.js';
import { loadJobFiles } from './files.js';
import { clip } from './format.js';
import { logger } from '../utils/logger.js';
import { getCurrentSocket } from '../whatsapp/socket.js';

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function deadlineOf(job) {
  const started = job.started_at ? new Date(job.started_at).getTime() : Date.now();
  return started + (Number(job.max_runtime_seconds) || 0) * 1000;
}

function userPrompt(job, files) {
  const lines = [
    `Execute this job to completion.`,
    `Job ID: ${job.id}`,
    `Task: ${job.task}`,
  ];
  if (job.context) lines.push(`Context: ${job.context}`);
  if (files.length) {
    lines.push('User files:');
    for (const file of files) {
      lines.push(`- ${file.filename} id=${file.id} readable=${file.readable} image=${file.is_image}`);
    }
    lines.push('Read attachments with read_attachment before guessing their contents.');
  }
  if (job.checkpoint && Object.keys(job.checkpoint).length) {
    lines.push(`Resume from checkpoint: ${JSON.stringify(job.checkpoint)}`);
  }
  lines.push('Log progress, persist memory, and save checkpoints as you go. When finished, write the final report with no more tool calls.');
  return lines.join('\n');
}

export async function executePersistenceJob(job, { workerId, shouldStop } = {}) {
  const config = getPersistenceConfig();
  let runtime = getPersistenceRuntime();
  const box = persistenceSandbox();
  let sandbox = null;
  try {
    sandbox = await getJobMachine(job);
    if (sandbox) {
      try {
        await ensureJobWorkspace(job, sandbox);
        await syncAttachmentsToWorkspace(job, sandbox);
      } catch (error) {
        logger.warn({ err: error, jobId: job.id }, 'persistence workspace setup failed; continuing without it');
        await addLog({ jobId: job.id, level: 'warn', message: `workspace setup failed: ${error.message}` });
      }
    }
  } catch (error) {
    logger.warn({ err: error, jobId: job.id }, 'persistence sandbox setup failed');
    await addLog({ jobId: job.id, level: 'warn', message: `sandbox setup failed: ${error.message}` });
  }

  const files = await loadJobFiles(job.id);
  const memories = await listJobMemories(job.id);
  const messages = [
    {
      role: 'system',
      content: persistenceSystemPrompt({
        job,
        sandbox: box,
        runtime,
        files,
        memories,
        checkpoint: job.checkpoint,
      }),
    },
    { role: 'user', content: userPrompt(job, files) },
  ];

  const toolContext = {
    jid: job.chat_jid,
    pushName: job.push_name,
    text: job.task,
    sock: getCurrentSocket(),
    message: null,
    environment: { isGroup: job.chat_type === 'group' },
    persistenceJob: job,
  };
  const artifacts = [];
  const tools = loadPersistenceTools({
    jid: job.chat_jid,
    isOwner: true,
  });
  const ctx = { job, sandbox, runtime, pendingImage: null };

  await updateJob(job.id, { status: 'running', progress: job.progress || 'Agent started.' });
  await addLog({ jobId: job.id, message: 'agent started', data: { model: runtime.modelId, sandbox: box?.id || null } });
  await addStep({ jobId: job.id, kind: 'status', title: 'started', content: job.task });

  let lastMessage = null;
  let round = 0;
  const deadline = deadlineOf(job);

  const heartbeat = async () => {
    const live = await heartbeatJob(job.id, workerId, config.leaseSeconds);
    if (!live) return { stop: true, reason: 'lost_lease' };
    if (live.cancel_requested) return { stop: true, reason: 'cancelled' };
    if (Date.now() > deadline) return { stop: true, reason: 'timed_out' };
    if (shouldStop?.()) return { stop: true, reason: 'stopped' };
    if (sandbox) await touchHeartbeat(sandbox, job.id);
    return { stop: false, live };
  };

  try {
    for (; round < config.maxRounds; round += 1) {
      const beat = await heartbeat();
      if (beat.stop) {
        return { status: beat.reason, round, artifacts };
      }

      if (ctx.pendingImage && runtime.imageSupport) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: `Inspect this attached image: ${ctx.pendingImage.filename}` },
            {
              type: 'image_url',
              image_url: { url: `data:${ctx.pendingImage.mimetype};base64,${ctx.pendingImage.base64}` },
            },
          ],
        });
        ctx.pendingImage = null;
      }

      const completion = await createChatCompletion({
        messages,
        tools,
        temperature: config.temperature,
        runtime,
        maxTokens: config.maxTokens,
        topP: config.topP,
        role: 'persistence',
      });
      if (completion?._runtime) runtime = completion._runtime;
      lastMessage = completion?.choices?.[0]?.message || null;
      if (!lastMessage) break;

      const toolCalls = getToolCalls(lastMessage);
      messages.push({
        role: 'assistant',
        content: lastMessage.content ?? null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });

      if (!toolCalls.length) break;

      for (const toolCall of toolCalls) {
        const name = toolCall?.function?.name;
        const args = parseArgs(toolCall.function?.arguments);
        await addLog({
          jobId: job.id,
          message: `tool ${name}`,
          data: {
            name,
            keys: Object.keys(args),
            path: args.path || null,
            action: args.action || null,
            machineId: args.machineId || args.sandboxId || null,
          },
        });
        await addStep({
          jobId: job.id,
          kind: 'tool',
          title: name,
          toolName: name,
          toolArgs: args,
          status: 'running',
        });

        let result;
        const pulse = setInterval(() => {
          heartbeat().catch(() => null);
        }, config.heartbeatMs);
        if (typeof pulse.unref === 'function') pulse.unref();
        try {
          toolContext.sock = getCurrentSocket();
          const internal = await runPersistenceTool(name, args, ctx);
          if (internal) {
            result = {
              message: {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(internal),
              },
              artifacts: [],
            };
          } else {
            result = await executeToolCall(toolCall, toolContext);
          }
        } finally {
          clearInterval(pulse);
        }

        messages.push(result.message);
        if (result.artifacts?.length) artifacts.push(...result.artifacts);
        logger.info(
          {
            jobId: job.id,
            name,
            machineId: args.machineId || args.sandboxId || null,
            output: clip(result.message?.content, 500),
          },
          'persistence tool result',
        );
        await addStep({
          jobId: job.id,
          kind: 'tool_result',
          title: name,
          toolName: name,
          toolResult: clip(result.message?.content, 4000),
          status: 'done',
        });

        const beatInner = await heartbeat();
        if (beatInner.stop) {
          return { status: beatInner.reason, round, artifacts };
        }
      }
    }

    const reply = extractText(lastMessage) || job.progress || 'The persistent agent finished without a written report.';
    return { status: 'completed', result: clip(reply, 8000), round, artifacts };
  } catch (error) {
    logger.error({ err: error, jobId: job.id }, 'persistence executor failed');
    await addLog({ jobId: job.id, level: 'error', message: error.message });
    return { status: 'failed', error: error.message, round, artifacts };
  }
}
