import { appConfig } from '../config/load-config.js';
import { getAiRuntime } from '../config/providers.js';
import { getChatSettings } from '../db/repositories/settings.js';
import { loadContext, saveTurn } from '../memory/store.js';
import { findPersonality, formatPersonalityPrompt, getDefaultPersonality } from '../personalities/load.js';
import { createPersistenceJob, persistenceAvailable } from '../persistence/manager.js';
import { executeToolCall, loadTools } from '../tools/index.js';
import { getToolOptions, isSlowTool } from '../tools/registry.js';
import { logger } from '../utils/logger.js';
import { BUSY_REACTIONS, CHECK, HOURGLASS, reactToMessage, removeReaction } from '../whatsapp/react.js';
import { formatEnvironmentPrompt } from '../whatsapp/group.js';
import { isOwnerJid } from '../whatsapp/owner.js';
import { isTelegramOwner } from '../telegram/owner.js';
import { createChatCompletion } from './client.js';
import { isGreeting } from './greetings.js';
import { buildMessages } from './prompt.js';
import { extractText, getToolCalls, stripToolCallText } from './tool-calls.js';

function defaultRecap(artifacts) {
  const names = artifacts.map((file) => file.filename).filter(Boolean);
  if (!names.length) return "I've finished.";
  if (names.length === 1) return `I've finished. I created ${names[0]} and sent it to you.`;
  return `I've finished. I created ${names.join(', ')} and sent them to you.`;
}

function fallbackReply({ artifacts = [], error = null } = {}) {
  if (artifacts.length) return defaultRecap(artifacts);
  const status = error?.status;
  const message = String(error?.message || '');
  if (status === 408 || /timed out/i.test(message)) {
    return 'That took too long on my side. Send it again and I will pick it up.';
  }
  if (status === 429 || /rate limit/i.test(message)) {
    return 'I am getting too many requests right now. Give me a moment and try again.';
  }
  if (status === 401 || status === 403) {
    return 'I could not reach the model just now. Try once more in a bit.';
  }
  if (status >= 500) {
    return 'The model is having a moment. Try that again in a few seconds.';
  }
  if (error) {
    return 'I hit a snag generating a reply. Try once more?';
  }
  return '';
}

function parseToolPayload(content) {
  try {
    return JSON.parse(content || '{}');
  } catch {
    return null;
  }
}

function saveAssistantTurn(jid, reply, extra = {}) {
  const runtime = extra.runtime || getAiRuntime();
  saveTurn(jid, 'assistant', reply, {
    model: runtime.modelId,
    provider: runtime.providerId,
    files: extra.files || [],
    persistenceJobId: extra.persistenceJobId,
  }).catch((error) => {
    logger.warn({ err: error, jid }, 'failed to save assistant turn');
  });
}

function summarizeToolWork(messages) {
  const names = [];
  for (const item of messages) {
    if (item?.role !== 'assistant' || !Array.isArray(item.tool_calls)) continue;
    for (const call of item.tool_calls) {
      const name = call?.function?.name;
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

async function handoffToPersistent({
  text,
  jid,
  memoryJid,
  pushName,
  sock,
  message,
  artifacts,
  runtime,
  roundsUsed,
  toolNames,
}) {
  if (!persistenceAvailable()) return null;
  const toolsUsed = toolNames.length ? ` Tools already used: ${toolNames.join(', ')}.` : '';
  const result = await createPersistenceJob({
    task: String(text || '').trim() || 'Continue and finish the user request.',
    context: [
      `The main WhatsApp bot already ran ${roundsUsed} tool round${roundsUsed === 1 ? '' : 's'} and is handing off because this is a long task.`,
      'Continue from the current progress. Do not redo finished steps.',
      toolsUsed.trim(),
      pushName ? `User display name: ${pushName}` : '',
    ].filter(Boolean).join(' '),
    jid,
    pushName,
    sock,
    message,
  });
  if (!result?.ok || !result?.reply) return null;
  saveAssistantTurn(memoryJid || jid, result.reply, {
    runtime,
    files: artifacts.map((file) => file.filename),
    persistenceJobId: result.id,
  });
  return {
    text: result.reply,
    artifacts,
    reaction: result.ok ? HOURGLASS : null,
  };
}

export async function generateReply({
  jid,
  memoryJid = null,
  text,
  pushName,
  sock,
  message,
  environment = null,
  existingReaction = '',
  image = null,
}) {
  const historyJid = memoryJid || jid;
  let history = [];
  let memories = [];

  try {
    const context = await loadContext(historyJid);
    history = context.history;
    memories = context.memories;
  } catch (error) {
    logger.warn({ err: error, jid: historyJid }, 'failed to load memory, continuing without it');
  }

  const lastHistory = history[history.length - 1];
  const historyForPrompt = lastHistory?.role === 'user'
    && (lastHistory.content === text || lastHistory.metadata?.replied)
    ? history.slice(0, -1)
    : history;

  let personality = getDefaultPersonality();
  try {
    const settings = await getChatSettings(historyJid);
    personality = findPersonality(settings?.personality) || personality;
  } catch (error) {
    logger.warn({ err: error, jid: historyJid }, 'failed to load chat personality');
  }

  const owner = sock?.platform === 'telegram'
    ? isTelegramOwner(message)
    : isOwnerJid(jid, sock);
  const runtime = getAiRuntime();
  const visionImage = runtime.imageSupport ? image : null;
  const messages = buildMessages({
    userText: text,
    history: historyForPrompt,
    memories,
    pushName,
    systemInstruction: formatPersonalityPrompt(personality),
    environment: {
      ...environment,
      prompt: environment?.prompt || formatEnvironmentPrompt(environment),
    },
    image: visionImage,
  });

  const tools = loadTools({
    jid,
    sock,
    isOwner: owner,
    environment,
    message,
  });
  const greeting = Boolean(text) && isGreeting(text);
  const datetimeEnabled = tools.some((tool) => tool.function?.name === 'get_datetime');
  const canCreateAgent = tools.some((tool) => tool.function?.name === 'create_agent');

  if (greeting && datetimeEnabled) {
    messages.push({
      role: 'system',
      content: 'The user greeted you. Call get_datetime with query="greeting" now. Then greet them by display name or firstName using greeting, timeOfDay, date, and timezone. Do not guess the time.',
    });
  }

  const artifacts = [];
  const maxRounds = appConfig.tools.maxRounds || 6;
  const handoffAfter = Math.max(1, Number.parseInt(appConfig.tools.handoffAfterRounds, 10) || 3);
  let lastMessage = null;
  let lastError = null;
  let reactedBusy = false;
  let doneReaction = null;
  let expressiveReaction = existingReaction || '';
  const toolContext = {
    jid,
    pushName,
    text,
    sock,
    message,
    environment,
    markReaction(emoji) {
      if (emoji && !BUSY_REACTIONS.has(emoji)) {
        expressiveReaction = emoji;
      }
    },
    setDoneReaction(emoji) {
      if (emoji) {
        doneReaction = emoji;
      }
    },
  };

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      if (canCreateAgent && round === handoffAfter - 1) {
        messages.push({
          role: 'system',
          content: 'You have already used several tool rounds. If any real work remains, call create_agent now with a detailed remaining task, job context, and what is already done. Do not keep looping tools on the main bot. If create_agent returns busy=true, reply with its reply field verbatim.',
        });
      }

      const toolChoice = greeting && datetimeEnabled && round === 0
        ? { type: 'function', function: { name: 'get_datetime' } }
        : undefined;

      let completion = null;
      try {
        completion = await createChatCompletion({
          messages,
          tools,
          toolChoice,
          temperature: personality?.temperature,
          runtime,
        });
      } catch (error) {
        lastError = error;
        logger.error({ err: error, jid, round }, 'chat completion failed');
        if (round === 0) {
          try {
            completion = await createChatCompletion({
              messages,
              tools: greeting ? tools : undefined,
              temperature: personality?.temperature,
              runtime,
            });
            lastError = null;
          } catch (retryError) {
            lastError = retryError;
            break;
          }
        } else {
          break;
        }
      }

      lastMessage = completion?.choices?.[0]?.message || null;
      if (!lastMessage) {
        logger.warn({ jid, round, finishReason: completion?.choices?.[0]?.finish_reason }, 'empty AI message');
        break;
      }

      const toolCalls = getToolCalls(lastMessage);
      messages.push({
        role: 'assistant',
        content: lastMessage.content ?? null,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      });

      if (!toolCalls.length) break;

      if (canCreateAgent && round >= handoffAfter && !toolCalls.some((call) => call?.function?.name === 'create_agent')) {
        const handed = await handoffToPersistent({
          text,
          jid,
          memoryJid: historyJid,
          pushName,
          sock,
          message,
          artifacts,
          runtime,
          roundsUsed: round + 1,
          toolNames: summarizeToolWork(messages),
        });
        if (handed) return handed;
      }

      for (const toolCall of toolCalls) {
        const name = toolCall?.function?.name;
        const options = getToolOptions(name);
        const busyEmoji = options.reactBusy ?? (isSlowTool(name) ? HOURGLASS : null);
        const finishedEmoji = options.reactDone !== undefined
          ? options.reactDone
          : (isSlowTool(name) ? CHECK : null);
        if (busyEmoji && !reactedBusy && !expressiveReaction) {
          await reactToMessage(sock, message, busyEmoji);
          reactedBusy = true;
        }
        if (finishedEmoji !== null && finishedEmoji !== undefined) {
          doneReaction = finishedEmoji;
        }
        const result = await executeToolCall(toolCall, toolContext);
        messages.push(result.message);
        if (result.artifacts?.length) {
          artifacts.push(...result.artifacts);
        }
        if (name === 'create_agent') {
          const parsed = parseToolPayload(result.message?.content);
          if (parsed?.reply) {
            if (parsed.ok) expressiveReaction = HOURGLASS;
            saveAssistantTurn(historyJid, parsed.reply, {
              runtime,
              files: artifacts.map((file) => file.filename),
              persistenceJobId: parsed.id,
            });
            return { text: parsed.reply, artifacts, reaction: parsed.ok ? HOURGLASS : expressiveReaction || null };
          }
        }
      }
    }
  } catch (error) {
    lastError = error;
    logger.error({ err: error, jid }, 'generateReply failed');
  } finally {
    if (reactedBusy && !expressiveReaction) {
      if (doneReaction === '') {
        await removeReaction(sock, message);
      } else if (doneReaction) {
        await reactToMessage(sock, message, doneReaction);
      }
    }
  }

  let reply = stripToolCallText(extractText(lastMessage));
  if (!reply) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const item = messages[i];
      if (item?.role !== 'assistant') continue;
      const leftover = stripToolCallText(extractText(item));
      if (leftover) {
        reply = leftover;
        break;
      }
    }
  }
  if (!reply && artifacts.length) {
    reply = defaultRecap(artifacts);
  }
  if (!reply) {
    reply = fallbackReply({ artifacts, error: lastError })
      || 'I could not finish that reply. Send it again and I will try a shorter pass.';
  }

  saveAssistantTurn(historyJid, reply, {
    runtime,
    files: artifacts.map((file) => file.filename),
  });

  return { text: reply, artifacts, reaction: expressiveReaction || null };
}
