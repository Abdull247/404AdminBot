import { appConfig } from '../config/load-config.js';
import {
  clearRuntimeCooldown,
  getAiRuntime,
  getFallbackPolicy,
  listFallbackChain,
  markRuntimeCooldown,
  resolveRoleMatch,
} from '../config/providers.js';
import { logger } from '../utils/logger.js';

export class AiClientError extends Error {
  constructor(message, status, body, runtime = null) {
    super(message);
    this.name = 'AiClientError';
    this.status = status;
    this.body = body;
    this.runtime = runtime;
    this.providerId = runtime?.providerId || null;
    this.modelId = runtime?.modelId || null;
  }
}

function shouldFallback(error, policy) {
  if (!policy?.enabled) return false;
  if (!(error instanceof AiClientError) && error?.name !== 'AiClientError') {
    return true;
  }
  const status = Number(error?.status) || 0;
  if (!status) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500 || status === 401 || status === 403;
}

function needsFromOptions({ tools, image, role }) {
  return {
    tools: Boolean(tools?.length),
    vision: Boolean(image),
    persistence: role === 'persistence',
    role: role || (image ? 'vision' : 'chat'),
  };
}

function stripToolsIfUnsupported(payload, runtime) {
  if (runtime?.support?.tools === false) {
    const next = { ...payload };
    delete next.tools;
    delete next.tool_choice;
    return next;
  }
  return payload;
}

function stripImagesIfUnsupported(messages, runtime) {
  if (runtime?.imageSupport || runtime?.support?.vision) return messages;
  return messages.map((item) => {
    if (!Array.isArray(item?.content)) return item;
    const textParts = item.content
      .filter((part) => part?.type !== 'image_url')
      .map((part) => (part?.type === 'text' ? part.text : ''))
      .filter(Boolean);
    return {
      ...item,
      content: textParts.join('\n') || 'The user sent an image, but this model cannot inspect it.',
    };
  });
}

async function postChatCompletion({ messages, tools, toolChoice, temperature, runtime, maxTokens, topP }) {
  const payload = stripToolsIfUnsupported({
    model: runtime.modelId,
    messages: stripImagesIfUnsupported(messages, runtime),
    temperature: Number.isFinite(temperature) ? temperature : appConfig.ai.temperature,
    max_tokens: Number.isFinite(maxTokens) ? maxTokens : (runtime.model?.limits?.maxTokens || appConfig.ai.maxTokens),
    top_p: Number.isFinite(topP) ? topP : appConfig.ai.topP,
    stream: Boolean(appConfig.ai.stream) && runtime.support?.streaming !== false,
  }, runtime);

  if (appConfig.tools.enabled && tools?.length && runtime.support?.tools !== false) {
    payload.tools = tools;
    payload.tool_choice = toolChoice || 'auto';
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(runtime.extraHeaders || {}),
  };
  if (runtime.apiKey) {
    headers.Authorization = `Bearer ${runtime.apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);

  try {
    logger.info({ provider: runtime.providerId, model: payload.model, stream: payload.stream }, 'calling AI chat completions');
    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AiClientError(
        `AI request failed with status ${response.status}`,
        response.status,
        body,
        runtime,
      );
    }
    if (!body?.choices?.length) {
      throw new AiClientError('AI returned no choices', 502, body, runtime);
    }

    clearRuntimeCooldown(runtime);
    return body;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AiClientError(`AI request timed out after ${runtime.timeoutMs}ms`, 408, null, runtime);
    }
    if (error instanceof AiClientError) throw error;
    logger.error({ err: error, provider: runtime.providerId, model: runtime.modelId }, 'AI request error');
    throw new AiClientError(error.message || 'AI request failed', error.status || 0, null, runtime);
  } finally {
    clearTimeout(timeout);
  }
}

export async function createChatCompletion({
  messages,
  tools,
  toolChoice,
  temperature,
  runtime,
  maxTokens,
  topP,
  role,
  image,
  fallback = true,
}) {
  const policy = getFallbackPolicy();
  const startRuntime = runtime || getAiRuntime(undefined, { role });
  if (!fallback || !policy.enabled) {
    const body = await postChatCompletion({
      messages,
      tools,
      toolChoice,
      temperature,
      runtime: startRuntime,
      maxTokens,
      topP,
    });
    body._runtime = startRuntime;
    return body;
  }

  const match = resolveRoleMatch(role, `${startRuntime.providerId}/${startRuntime.modelId}`)
    || resolveRoleMatch(role, startRuntime.modelId);
  const chain = listFallbackChain({
    start: match || { provider: { id: startRuntime.providerId, models: [startRuntime.model], enabled: true, priority: 100 }, model: startRuntime.model },
    needs: needsFromOptions({ tools, image, role }),
    includeStart: true,
  });
  const attempts = chain.length ? chain : [{ runtime: startRuntime, reason: 'start' }];
  const maxAttempts = Math.max(1, Math.min(policy.maxAttempts || 10, attempts.length));
  let lastError = null;

  for (let index = 0; index < maxAttempts; index += 1) {
    const candidate = attempts[index];
    const nextRuntime = candidate.runtime || startRuntime;
    try {
      if (index > 0) {
        logger.warn({
          from: lastError?.modelId || startRuntime.modelId,
          to: nextRuntime.modelId,
          provider: nextRuntime.providerId,
          reason: candidate.reason,
          status: lastError?.status || null,
        }, 'falling back to next AI model');
      }
      const body = await postChatCompletion({
        messages,
        tools: nextRuntime.support?.tools === false ? undefined : tools,
        toolChoice: nextRuntime.support?.tools === false ? undefined : toolChoice,
        temperature,
        runtime: nextRuntime,
        maxTokens,
        topP,
      });
      body._runtime = nextRuntime;
      return body;
    } catch (error) {
      lastError = error;
      markRuntimeCooldown(nextRuntime, error, policy);
      logger.warn({
        err: error,
        provider: nextRuntime.providerId,
        model: nextRuntime.modelId,
        status: error?.status || null,
        attempt: index + 1,
        remaining: maxAttempts - index - 1,
      }, 'AI model failed');
      if (!shouldFallback(error, policy)) break;
    }
  }

  throw lastError || new AiClientError('AI request failed', 502, null, startRuntime);
}
