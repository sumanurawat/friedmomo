/**
 * AI Client — all calls go through the local backend server (/api/ai/*).
 * API keys stay server-side; the frontend never touches provider APIs directly.
 */

import { useSettingsStore } from '../store/settings-store.js';
import { logger } from './logger.js';

// Total cap so a runaway response can't stream forever. Can be raised if needed.
const STREAM_TOTAL_CAP_MS = 15 * 60_000;        // 15 minutes
// If we go this long with no new bytes from the upstream, give up.
const STREAM_IDLE_TIMEOUT_MS = 90_000;          // 90 seconds of silence
// First-byte (TTFB) timeout — if backend sends zero bytes, fail fast.
const STREAM_CONNECT_TIMEOUT_MS = 60_000;       // 60 seconds for the initial status/first byte
const IMAGE_TIMEOUT_MS = 180_000;

function makeClientRequestId() {
  try {
    return crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
  } catch {
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }
}

function getAiConfig() {
  const state = useSettingsStore.getState();
  return {
    planningProvider: state.planningProvider || 'openrouter',
    planningModel: state.planningModel || '',
    imageProvider: state.imageProvider || 'openrouter',
    imageModel: state.imageModel || '',
  };
}

/**
 * Send a chat message with streaming via SSE through the backend proxy.
 */
export async function sendMessage({ model, systemPrompt, messages, onToken, onDone, onError }) {
  const config = getAiConfig();
  const provider = config.planningProvider;
  const resolvedModel = model || config.planningModel;
  const clientRequestId = makeClientRequestId();

  if (!resolvedModel) {
    const err = new Error('No planning model selected. Choose one in Settings.');
    logger.warn('ai.chat.missing_model', { clientRequestId });
    await onError?.(err);
    return;
  }

  const controller = new AbortController();
  // Reason tags so the catch block can tell apart connect-timeout, idle-timeout, and total-cap.
  let abortReason = null;

  // Three timers, all cancellable:
  //  - connectTimer: fires if response headers never arrive
  //  - idleTimer:    reset on every chunk; fires if the stream goes silent
  //  - capTimer:     hard stop so a runaway response can't stream forever
  let connectTimer = setTimeout(() => {
    abortReason = 'connect_timeout';
    controller.abort('connect_timeout');
  }, STREAM_CONNECT_TIMEOUT_MS);
  let idleTimer = null;
  const capTimer = setTimeout(() => {
    abortReason = 'total_cap';
    controller.abort('total_cap');
  }, STREAM_TOTAL_CAP_MS);

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReason = 'idle_timeout';
      controller.abort('idle_timeout');
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  const clearAllTimers = () => {
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    if (idleTimer)    { clearTimeout(idleTimer);    idleTimer = null;    }
    clearTimeout(capTimer);
  };

  const startedAt = performance.now();
  let fullText = '';
  let chunkCount = 0;
  let lastChunkAt = startedAt;
  let serverRequestId = null;

  logger.info('ai.chat.send', {
    clientRequestId,
    provider,
    model: resolvedModel,
    messageCount: messages?.length || 0,
    systemPromptChars: systemPrompt ? String(systemPrompt).length : 0,
  });

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Request-Id': clientRequestId,
      },
      body: JSON.stringify({ provider, model: resolvedModel, systemPrompt, messages }),
    });

    // Headers arrived — connect timer done, switch to idle mode.
    clearTimeout(connectTimer); connectTimer = null;
    serverRequestId = response.headers.get('X-Request-Id');

    logger.info('ai.chat.headers', {
      clientRequestId,
      serverRequestId,
      status: response.status,
      ttfbMs: Math.round(performance.now() - startedAt),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const err = new Error(errData?.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.serverRequestId = serverRequestId;
      throw err;
    }

    resetIdle();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunkCount += 1;
      lastChunkAt = performance.now();
      resetIdle();

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const data = JSON.parse(dataStr);
          const text = data?.choices?.[0]?.delta?.content;
          if (text != null && text !== '') {
            fullText += text;
            onToken?.(text, fullText);
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    clearAllTimers();
    logger.info('ai.chat.done', {
      clientRequestId,
      serverRequestId,
      provider,
      model: resolvedModel,
      durationMs: Math.round(performance.now() - startedAt),
      chunks: chunkCount,
      responseChars: fullText.length,
    });
    await onDone?.(fullText);
  } catch (error) {
    clearAllTimers();
    const isAbort = error?.name === 'AbortError' || controller.signal.aborted;
    const durationMs = Math.round(performance.now() - startedAt);
    const lastChunkAgoMs = Math.round(performance.now() - lastChunkAt);

    if (isAbort) {
      const reason = abortReason || 'aborted';
      let userMsg;
      if (reason === 'connect_timeout') {
        userMsg = `The backend did not respond within ${STREAM_CONNECT_TIMEOUT_MS / 1000}s. Check that the AI provider is reachable.`;
      } else if (reason === 'idle_timeout') {
        userMsg = `The AI stopped sending data for ${STREAM_IDLE_TIMEOUT_MS / 1000}s. Try a faster model or a shorter prompt.`;
      } else if (reason === 'total_cap') {
        userMsg = `The response exceeded the ${STREAM_TOTAL_CAP_MS / 60_000}-minute hard cap. Ask for a shorter piece, or break the request into chapters.`;
      } else {
        userMsg = 'The request was cancelled.';
      }
      logger.error('ai.chat.timeout', {
        clientRequestId,
        serverRequestId,
        provider,
        model: resolvedModel,
        reason,
        durationMs,
        chunks: chunkCount,
        lastChunkAgoMs,
        partialChars: fullText.length,
      });
      await onError?.(new Error(userMsg));
    } else {
      logger.error('ai.chat.error', {
        clientRequestId,
        serverRequestId,
        provider,
        model: resolvedModel,
        durationMs,
        chunks: chunkCount,
        message: error?.message || String(error),
        stack: error?.stack,
        status: error?.status,
      });
      await onError?.(humanizeError(error));
    }
  }
}

/**
 * Generate a short story title via the backend.
 *
 * NOTE: Titles are 2–5 words, so we do NOT want to pay flagship prices here.
 * We deliberately omit provider/model from the request body and let the
 * server fall back to its cheap DEFAULT_TITLE_MODEL (see server/routes/ai.js).
 * If the user later wants a specific title model, we can thread that through
 * a new settings field.
 */
export async function generateTitle(userMessage) {
  const clientRequestId = makeClientRequestId();
  try {
    const response = await fetch('/api/ai/title', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Request-Id': clientRequestId,
      },
      body: JSON.stringify({
        // server picks provider/model from its cheap defaults
        userMessage,
      }),
    });
    if (!response.ok) {
      logger.warn('ai.title.error', { clientRequestId, status: response.status });
      return 'Untitled Story';
    }
    const data = await response.json();
    logger.info('ai.title.done', {
      clientRequestId,
      serverRequestId: response.headers.get('X-Request-Id'),
      model: data?.model,
    });
    return data?.title || 'Untitled Story';
  } catch (err) {
    logger.error('ai.title.exception', { clientRequestId, message: err?.message });
    return 'Untitled Story';
  }
}

/**
 * Generate an image via the backend proxy.
 */
export async function generateImage({ prompt, model }) {
  const config = getAiConfig();
  const provider = config.imageProvider;
  const resolvedModel = model || config.imageModel;
  const clientRequestId = makeClientRequestId();

  if (!resolvedModel) throw new Error('No image model selected. Choose one in Settings.');

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const startedAt = performance.now();

  logger.info('ai.image.send', {
    clientRequestId,
    provider,
    model: resolvedModel,
    promptChars: String(prompt || '').length,
  });

  try {
    const response = await fetch('/api/ai/image', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Request-Id': clientRequestId,
      },
      body: JSON.stringify({ provider, model: resolvedModel, prompt }),
    });
    clearTimeout(timeoutHandle);
    const serverRequestId = response.headers.get('X-Request-Id');

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      logger.error('ai.image.error', {
        clientRequestId,
        serverRequestId,
        provider,
        model: resolvedModel,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        message: errData?.error,
      });
      throw new Error(errData?.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    logger.info('ai.image.done', {
      clientRequestId,
      serverRequestId,
      provider,
      model: resolvedModel,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return data;
  } catch (error) {
    clearTimeout(timeoutHandle);
    if (error?.name === 'AbortError') {
      logger.error('ai.image.timeout', {
        clientRequestId,
        provider,
        model: resolvedModel,
        timeoutMs: IMAGE_TIMEOUT_MS,
      });
      throw new Error(`Image generation timed out after ${IMAGE_TIMEOUT_MS / 1000}s.`);
    }
    logger.error('ai.image.exception', {
      clientRequestId,
      provider,
      model: resolvedModel,
      message: error?.message,
      stack: error?.stack,
    });
    throw error;
  }
}

/**
 * Validate an API key via the backend.
 */
export async function validateKey({ provider, apiKey }) {
  if (!apiKey) return { valid: false, error: 'No API key provided.' };
  try {
    const response = await fetch('/api/ai/validate-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    });
    return await response.json();
  } catch (error) {
    return { valid: false, error: error.message || 'Connection failed.' };
  }
}

/**
 * Fetch available models from a provider via the backend.
 */
export async function listModels({ provider }) {
  try {
    const response = await fetch(`/api/ai/models?provider=${encodeURIComponent(provider)}`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

export function humanizeError(error) {
  if (!error) return new Error('An unknown error occurred.');
  const msg = String(error.message || error || '').trim();

  if (msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('ENOTFOUND')) {
    return new Error('Could not connect to the AI provider. Check your network connection.');
  }
  if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('401')) {
    return new Error('The API key is not valid. Check Settings and try again.');
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
    return new Error('Rate limit exceeded. Please try again in a moment.');
  }
  if (msg.includes('safety') || msg.includes('blocked')) {
    return new Error('The request was blocked by the AI model. Try simplifying the prompt.');
  }
  return new Error(msg || 'The AI provider could not complete that request.');
}
