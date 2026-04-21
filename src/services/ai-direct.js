/**
 * AI client — direct-to-OpenRouter (browser mode, no backend).
 *
 * Public surface matches ai-backend.js exactly, so upstream consumers
 * (ai-client.js facade, stores, components) don't know or care which
 * implementation is active. The mode is picked at build time — see
 * src/services/platform.js.
 *
 * All requests go straight to https://openrouter.ai/api/v1/* using the
 * key stored in settings (localStorage-backed in web mode). OpenRouter
 * allows any origin with CORS, so nothing is proxied.
 */

import { useSettingsStore } from '../store/settings-store.js';
import { logger } from './logger.js';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
// IMPORTANT: /v1/models is PUBLIC (returns 200 without auth), so it can't be
// used to validate a key. /v1/auth/key is the authenticated endpoint — it
// returns 200 with key metadata when the key is valid, and 401 when it isn't.
const OPENROUTER_AUTH_KEY_URL = 'https://openrouter.ai/api/v1/auth/key';

// Timeouts mirror the backend version so UX is identical across modes.
const STREAM_TOTAL_CAP_MS = 15 * 60_000;
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const STREAM_CONNECT_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS = 180_000;

// Title calls are hard-locked to a cheap model, same as the backend.
// Keep in sync with server/routes/ai.js and DEFAULT_TITLE_MODEL in providers.js.
const TITLE_MODEL = 'google/gemini-3.1-flash-lite-preview';

function makeClientRequestId() {
  try {
    return crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2);
  } catch {
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }
}

function getApiKey(provider) {
  const state = useSettingsStore.getState();
  return String(state.providerKeys?.[provider] || '').trim();
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

function buildOpenAIMessages(systemPrompt, messages) {
  const out = [];
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
  for (const msg of messages || []) {
    out.push({
      role: msg.role === 'model' ? 'assistant' : msg.role,
      content: (msg.parts || []).map((p) => p.text || '').join('') || msg.content || '',
    });
  }
  return out;
}

function openRouterHeaders(apiKey) {
  // HTTP-Referer and X-Title help OpenRouter attribute usage / rank listings.
  // Harmless if OpenRouter ever tightens CORS — these are all in the allow-list.
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://friedmomo.com',
    'X-Title': 'Storyboarder',
  };
}

/**
 * Streaming chat — reads OpenAI-style SSE directly from OpenRouter.
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

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    const err = new Error(`No API key for ${provider}. Add one in Settings.`);
    logger.warn('ai.chat.missing_key', { clientRequestId, provider });
    await onError?.(err);
    return;
  }

  const controller = new AbortController();
  let abortReason = null;

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

  logger.info('ai.chat.send', {
    clientRequestId,
    mode: 'web',
    provider,
    model: resolvedModel,
    messageCount: messages?.length || 0,
    systemPromptChars: systemPrompt ? String(systemPrompt).length : 0,
  });

  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: resolvedModel,
        messages: buildOpenAIMessages(systemPrompt, messages),
        stream: true,
        // Force structured JSON output. The system prompt already says
        // "Return valid JSON ONLY" but the rule is unenforceable without
        // this flag — models sometimes emit a prose summary instead, which
        // the parser then treats as chat with zero updates, leaving the
        // default storyboard scaffold untouched and the user staring at an
        // empty board. OpenRouter passes this through to every provider;
        // models that don't natively support JSON mode get it emulated.
        response_format: { type: 'json_object' },
      }),
    });

    clearTimeout(connectTimer); connectTimer = null;

    logger.info('ai.chat.headers', {
      clientRequestId,
      status: response.status,
      ttfbMs: Math.round(performance.now() - startedAt),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const err = new Error(errData?.error?.message || errData?.error || `HTTP ${response.status}`);
      err.status = response.status;
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
      mode: 'web',
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
        userMsg = `OpenRouter did not respond within ${STREAM_CONNECT_TIMEOUT_MS / 1000}s. Check your internet connection.`;
      } else if (reason === 'idle_timeout') {
        userMsg = `The AI stopped sending data for ${STREAM_IDLE_TIMEOUT_MS / 1000}s. Try a faster model or a shorter prompt.`;
      } else if (reason === 'total_cap') {
        userMsg = `The response exceeded the ${STREAM_TOTAL_CAP_MS / 60_000}-minute hard cap. Ask for a shorter piece.`;
      } else {
        userMsg = 'The request was cancelled.';
      }
      logger.error('ai.chat.timeout', {
        clientRequestId,
        mode: 'web',
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
        mode: 'web',
        provider,
        model: resolvedModel,
        durationMs,
        chunks: chunkCount,
        message: error?.message || String(error),
        status: error?.status,
      });
      await onError?.(humanizeError(error));
    }
  }
}

/**
 * Cheap title generation — always uses the locked TITLE_MODEL.
 */
export async function generateTitle(userMessage) {
  const clientRequestId = makeClientRequestId();
  const apiKey = getApiKey('openrouter');
  if (!apiKey) {
    logger.warn('ai.title.missing_key', { clientRequestId });
    return 'Untitled Story';
  }

  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: TITLE_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Generate a concise, creative story title (2-5 words) based on this message. Return only the title — no quotes, no punctuation at the end, no explanation.',
          },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    if (!response.ok) {
      logger.warn('ai.title.error', { clientRequestId, status: response.status });
      return 'Untitled Story';
    }
    const data = await response.json();
    const title = String(data?.choices?.[0]?.message?.content || '').trim();
    logger.info('ai.title.done', { clientRequestId, model: TITLE_MODEL, titleChars: title.length });
    return title || 'Untitled Story';
  } catch (err) {
    logger.error('ai.title.exception', { clientRequestId, message: err?.message });
    return 'Untitled Story';
  }
}

/**
 * Single-image generation. Matches the image payload shape that backend route
 * sends upstream — OpenRouter accepts it unchanged.
 */
export async function generateImage({ prompt, model }) {
  const config = getAiConfig();
  const provider = config.imageProvider;
  const resolvedModel = model || config.imageModel;
  const clientRequestId = makeClientRequestId();

  if (!resolvedModel) throw new Error('No image model selected. Choose one in Settings.');
  const apiKey = getApiKey(provider);
  if (!apiKey) throw new Error(`No API key for ${provider}. Add one in Settings.`);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const startedAt = performance.now();

  logger.info('ai.image.send', {
    clientRequestId,
    mode: 'web',
    provider,
    model: resolvedModel,
    promptChars: String(prompt || '').length,
  });

  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: 'user', content: String(prompt) }],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: '16:9' },
        stream: false,
      }),
    });
    clearTimeout(timeoutHandle);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const err = new Error(errData?.error?.message || errData?.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.upstreamStatus = response.status;
      // OpenRouter returns a numeric `retry_after` header or payload field on 429.
      const retryAfter = Number(response.headers.get('retry-after') || errData?.error?.metadata?.retry_after || 0);
      if (retryAfter > 0) err.retryAfterSeconds = retryAfter;
      logger.error('ai.image.error', {
        clientRequestId,
        mode: 'web',
        provider,
        model: resolvedModel,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
        message: err.message,
      });
      throw err;
    }

    const data = await response.json();
    const imageUrl = extractImageUrl(data);
    if (!imageUrl) {
      const err = new Error('Model did not return an image');
      err.diagnosticCode = 'no_image_empty_response';
      throw err;
    }

    logger.info('ai.image.done', {
      clientRequestId,
      mode: 'web',
      provider,
      model: resolvedModel,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return {
      imageUrl,
      model: resolvedModel,
      provider,
      diagnosticCode: 'success',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    clearTimeout(timeoutHandle);
    if (error?.name === 'AbortError') {
      logger.error('ai.image.timeout', {
        clientRequestId,
        provider,
        model: resolvedModel,
        timeoutMs: IMAGE_TIMEOUT_MS,
      });
      const err = new Error(`Image generation timed out after ${IMAGE_TIMEOUT_MS / 1000}s.`);
      err.diagnosticCode = 'timeout';
      throw err;
    }
    logger.error('ai.image.exception', {
      clientRequestId,
      provider,
      model: resolvedModel,
      message: error?.message,
    });
    throw error;
  }
}

/**
 * Key validation — hit /auth/key with the supplied key.
 *
 * DO NOT use /v1/models — that endpoint is public and returns 200 for any
 * request, including ones with gibberish keys. /v1/auth/key requires a
 * valid bearer token and returns 401 otherwise, so it's the real check.
 */
export async function validateKey({ provider, apiKey }) {
  if (!apiKey) return { valid: false, error: 'No API key provided.' };
  if (provider !== 'openrouter') {
    return { valid: false, error: `Unknown provider: ${provider}` };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(OPENROUTER_AUTH_KEY_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    clearTimeout(timeout);
    if (resp.ok) return { valid: true };
    if (resp.status === 401 || resp.status === 403) return { valid: false, error: 'Invalid API key.' };
    return { valid: false, error: `Provider returned HTTP ${resp.status}.` };
  } catch (err) {
    if (err?.name === 'AbortError') return { valid: false, error: 'Connection timed out.' };
    return { valid: false, error: err.message || 'Connection failed.' };
  }
}

/**
 * List models for a given provider. In web mode we talk to OpenRouter directly.
 */
export async function listModels({ provider }) {
  if (provider !== 'openrouter') return [];
  const apiKey = getApiKey(provider);
  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(OPENROUTER_MODELS_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const data = await resp.json();
    const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return raw
      .map((m) => {
        const arch = m?.architecture || {};
        const outputModalities = Array.isArray(arch.output_modalities) ? arch.output_modalities : [];
        return {
          id: String(m.id || m.name || '').trim(),
          name: String(m.name || m.id || '').trim(),
          context_length: Number(m.context_length || 0) || null,
          // Pass-through capability info so the Models page can filter, e.g.
          // show only image-generating models in the image picker.
          outputModalities,
        };
      })
      .filter((m) => m.id);
  } catch {
    return [];
  }
}

export function humanizeError(error) {
  if (!error) return new Error('An unknown error occurred.');
  const msg = String(error.message || error || '').trim();

  if (msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    return new Error('Could not reach OpenRouter. Check your internet connection.');
  }
  if (msg.toLowerCase().includes('api key') || msg.toLowerCase().includes('401')) {
    return new Error('The API key is not valid. Check Settings and try again.');
  }
  if (msg.includes('429') || /rate limit|quota/i.test(msg)) {
    return new Error('Rate limit exceeded. Please try again in a moment.');
  }
  if (/safety|blocked/i.test(msg)) {
    return new Error('The request was blocked by the AI model. Try simplifying the prompt.');
  }
  return new Error(msg || 'The AI provider could not complete that request.');
}

function extractImageUrl(payload) {
  const images = payload?.choices?.[0]?.message?.images || [];
  for (const image of images) {
    const url = String(image?.image_url?.url || '').trim();
    if (url) return url;
  }
  return '';
}
