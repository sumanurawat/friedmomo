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
 * Cheap one-shot: decide the visual style for this whole story from the first
 * user prompt. Returns a single concrete sentence (medium + palette + line
 * quality + mood) that's stored on the Project and echoed verbatim into every
 * image prompt so the whole board reads as one piece.
 *
 * Uses the same cheap TITLE_MODEL — this is a 1-sentence output, no reasoning
 * required. Fails soft: returns '' so the caller can fall back to a default.
 */
export async function generateStoryStyle(userMessage) {
  const clientRequestId = makeClientRequestId();
  const apiKey = getApiKey('openrouter');
  if (!apiKey) {
    logger.warn('ai.style.missing_key', { clientRequestId });
    return '';
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
              'You pick the visual style for a storyboard. Given a story premise, respond with ONE concrete sentence describing the ideal visual style for every Shot (the medium, line quality, palette, mood). Keep it tight and shootable. Examples:\n' +
              '- "Monochrome pencil storyboard, rough crosshatching, gritty noir mood, 16:9 letterbox, no text overlays."\n' +
              '- "Soft watercolor storyboard, muted pastels, whimsical children\'s-book feel, pencil-inked outlines, no text overlays."\n' +
              '- "Bold ink-and-wash storyboard, saturated primaries, high contrast, anime-inspired lines, no text overlays."\n' +
              '- "Photoreal cinematic storyboard, desaturated teal-and-orange palette, soft anamorphic bokeh, no text overlays."\n' +
              'Return ONLY the sentence — no quotes, no preamble, no explanation. Always end with ", no text overlays." so the image model does not render frame numbers or captions.',
          },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    if (!response.ok) {
      logger.warn('ai.style.error', { clientRequestId, status: response.status });
      return '';
    }
    const data = await response.json();
    const style = String(data?.choices?.[0]?.message?.content || '').trim();
    logger.info('ai.style.done', {
      clientRequestId,
      model: TITLE_MODEL,
      styleChars: style.length,
      stylePreview: style.slice(0, 120),
    });
    return style;
  } catch (err) {
    logger.error('ai.style.exception', { clientRequestId, message: err?.message });
    return '';
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
export async function generateImage({ prompt, model, regenId, attemptNumber }) {
  const config = getAiConfig();
  const provider = config.imageProvider;
  const resolvedModel = model || config.imageModel;
  const clientRequestId = makeClientRequestId();
  const attemptId = `at-${Math.random().toString(36).slice(2, 8)}`;
  const promptStr = String(prompt || '');
  const promptChars = promptStr.length;

  if (!resolvedModel) throw new Error('No image model selected. Choose one in Settings.');
  const apiKey = getApiKey(provider);
  if (!apiKey) throw new Error(`No API key for ${provider}. Add one in Settings.`);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const startedAt = performance.now();

  // Rich start log — every subsequent event carries regenId + attemptId so
  // a single attempt can be traced end-to-end even across interleaved
  // concurrent image jobs.
  logger.info('img.generate.start', {
    regenId: regenId || null,
    attemptId,
    attemptNumber: attemptNumber || null,
    clientRequestId,
    mode: 'web',
    provider,
    model: resolvedModel,
    promptChars,
    promptPreview: promptStr.slice(0, 180),
    timeoutMs: IMAGE_TIMEOUT_MS,
  });

  try {
    const response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: openRouterHeaders(apiKey),
      body: JSON.stringify({
        model: resolvedModel,
        messages: [{ role: 'user', content: promptStr }],
        modalities: ['image', 'text'],
        image_config: { aspect_ratio: '16:9' },
        stream: false,
      }),
    });
    clearTimeout(timeoutHandle);

    const ttfbMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      // Capture the raw body AS TEXT first so we can log a preview even if
      // the payload isn't valid JSON. This is the single most useful signal
      // when OpenRouter returns a weird error shape.
      const rawBody = await response.text().catch(() => '');
      let errData = {};
      try { errData = JSON.parse(rawBody); } catch { /* keep empty object */ }

      const err = new Error(errData?.error?.message || errData?.error || `HTTP ${response.status}`);
      err.status = response.status;
      err.upstreamStatus = response.status;
      err.diagnosticCode = response.status === 429 ? 'rate_limited' : 'upstream_http_error';

      const retryAfter = Number(
        response.headers.get('retry-after') || errData?.error?.metadata?.retry_after || 0
      );
      if (retryAfter > 0) err.retryAfterSeconds = retryAfter;

      logger.error('img.generate.http_error', {
        regenId: regenId || null,
        attemptId,
        attemptNumber: attemptNumber || null,
        clientRequestId,
        provider,
        model: resolvedModel,
        status: response.status,
        durationMs: ttfbMs,
        retryAfterSeconds: retryAfter > 0 ? retryAfter : null,
        errorCode: errData?.error?.code || null,
        errorType: errData?.error?.type || null,
        errorMessage: err.message,
        // First 500 chars of the raw body — enough to see what upstream
        // actually said without bloating log storage.
        bodyPreview: rawBody.slice(0, 500),
        bodyBytes: rawBody.length,
      });
      throw err;
    }

    const rawBody = await response.text();
    let data = {};
    try {
      data = JSON.parse(rawBody);
    } catch (parseErr) {
      logger.error('img.generate.parse_error', {
        regenId: regenId || null,
        attemptId,
        clientRequestId,
        provider,
        model: resolvedModel,
        durationMs: ttfbMs,
        parseError: String(parseErr?.message || parseErr),
        bodyPreview: rawBody.slice(0, 500),
        bodyBytes: rawBody.length,
      });
      const err = new Error('Image endpoint returned non-JSON response.');
      err.diagnosticCode = 'parse_error';
      throw err;
    }

    const imageUrl = extractImageUrl(data);
    const choice = data?.choices?.[0];
    const message = choice?.message || {};
    const imagesArray = Array.isArray(message.images) ? message.images : [];
    const textContent = typeof message.content === 'string' ? message.content : '';

    if (!imageUrl) {
      // CRITICAL log for debugging content-filter blocks: models that decline
      // to generate an image usually return a text explanation instead of the
      // image. Capture that text + the response shape so we know why.
      logger.error('img.generate.no_image', {
        regenId: regenId || null,
        attemptId,
        attemptNumber: attemptNumber || null,
        clientRequestId,
        provider,
        model: resolvedModel,
        durationMs: ttfbMs,
        responseShape: {
          choicesCount: Array.isArray(data?.choices) ? data.choices.length : 0,
          imagesCount: imagesArray.length,
          hasText: Boolean(textContent),
          textChars: textContent.length,
          finishReason: choice?.finish_reason || null,
          messageKeys: Object.keys(message),
        },
        // The text the model emitted instead of the image — often reveals a
        // content-policy refusal or an instruction-ignorance issue.
        textResponse: textContent.slice(0, 400),
        promptPreview: promptStr.slice(0, 120),
      });
      const err = new Error(
        textContent
          ? `Model returned text instead of an image: "${textContent.slice(0, 140)}…"`
          : 'Model did not return an image'
      );
      err.diagnosticCode = textContent ? 'no_image_text_only' : 'no_image_empty_response';
      err.diagnosticMessage = textContent || 'Empty choices[].message.images on success response.';
      throw err;
    }

    // Success — log the body shape so we can audit latency trends and
    // verify which model actually served the request.
    logger.info('img.generate.ok', {
      regenId: regenId || null,
      attemptId,
      attemptNumber: attemptNumber || null,
      clientRequestId,
      provider,
      model: resolvedModel,
      modelReturned: data?.model || null,
      durationMs: ttfbMs,
      bodyBytes: rawBody.length,
      imageUrlKind: imageUrl.startsWith('data:')
        ? `data:${imageUrl.slice(5, 25).split(';')[0]}`
        : 'remote_url',
      imageUrlBytes: imageUrl.length,
      finishReason: choice?.finish_reason || null,
    });

    return {
      imageUrl,
      model: resolvedModel,
      provider,
      diagnosticCode: 'success',
      latencyMs: ttfbMs,
    };
  } catch (error) {
    clearTimeout(timeoutHandle);
    if (error?.name === 'AbortError') {
      logger.error('img.generate.timeout', {
        regenId: regenId || null,
        attemptId,
        attemptNumber: attemptNumber || null,
        clientRequestId,
        provider,
        model: resolvedModel,
        timeoutMs: IMAGE_TIMEOUT_MS,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      const err = new Error(`Image generation timed out after ${IMAGE_TIMEOUT_MS / 1000}s.`);
      err.diagnosticCode = 'timeout';
      throw err;
    }
    // Only log an extra line if we haven't already logged a specific event
    // (http_error / parse_error / no_image each log their own). Detect by
    // looking at diagnosticCode — those paths set it before throwing.
    if (!error?.diagnosticCode) {
      logger.error('img.generate.exception', {
        regenId: regenId || null,
        attemptId,
        clientRequestId,
        provider,
        model: resolvedModel,
        errorName: error?.name,
        errorMessage: error?.message,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }
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
