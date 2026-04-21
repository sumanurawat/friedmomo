/**
 * /api/ai routes — proxy AI requests through the backend.
 *
 * POST /api/ai/chat          — streaming chat completion (SSE)
 * POST /api/ai/title         — generate a story title
 * POST /api/ai/image         — generate an image
 * POST /api/ai/validate-key  — validate a provider API key
 * GET  /api/ai/models        — list available models for a provider
 */

import * as store from '../fs-storage.js';
import { logger } from '../logger.js';

// Only OpenRouter is supported.
const PROVIDER_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

const MODEL_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/models',
};

// Key-validation endpoints — these MUST require auth, otherwise any gibberish
// key passes. OpenRouter's /v1/models is public, so we use /v1/auth/key here.
const VALIDATE_KEY_ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/auth/key',
};

// Title generation is HARD-LOCKED to a cheap model. Titles are 2-5 words and
// don't need flagship reasoning. Any provider/model fields in the request
// body are IGNORED — this is intentional so a misconfigured client can never
// opt the title call into an expensive planner model. Change the constants
// here if you want a different cheap/free title model.
const TITLE_PROVIDER = 'openrouter';
const TITLE_MODEL = 'google/gemini-2.5-flash-lite';

async function getApiKey(provider) {
  const settings = await store.loadSettings();
  return String(settings?.providerKeys?.[provider] || '').trim();
}

export async function handleAI(ctx) {
  const { method, path, res, requestId, clientRequestId } = ctx;

  // POST /api/ai/chat — streaming
  if (path === '/api/ai/chat' && method === 'POST') {
    const body = await ctx.body();
    const { provider, model, systemPrompt, messages } = body || {};

    const apiKey = await getApiKey(provider);
    if (!apiKey) {
      logger.warn('ai.chat.missing_key', { requestId, clientRequestId, provider });
      return ctx.json({ error: `No API key for ${provider}`, requestId }, 400);
    }
    if (!model) {
      logger.warn('ai.chat.missing_model', { requestId, clientRequestId, provider });
      return ctx.json({ error: 'No model specified', requestId }, 400);
    }

    const endpoint = PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.openrouter;
    const oaiMessages = [];
    if (systemPrompt) oaiMessages.push({ role: 'system', content: systemPrompt });
    for (const msg of messages || []) {
      oaiMessages.push({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: (msg.parts || []).map((p) => p.text || '').join('') || msg.content || '',
      });
    }

    const startedAt = Date.now();
    logger.info('ai.chat.start', {
      requestId,
      clientRequestId,
      provider,
      model,
      messageCount: oaiMessages.length,
      systemPromptChars: systemPrompt ? String(systemPrompt).length : 0,
      endpoint,
    });

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages: oaiMessages, stream: true }),
      });

      logger.info('ai.chat.upstream_headers', {
        requestId,
        provider,
        model,
        status: upstream.status,
        ttfbMs: Date.now() - startedAt,
      });

      if (!upstream.ok) {
        const err = await upstream.json().catch(() => ({}));
        logger.error('ai.chat.upstream_error', {
          requestId,
          clientRequestId,
          provider,
          model,
          status: upstream.status,
          upstreamError: err?.error?.message || err,
        });
        return ctx.json({ error: err?.error?.message || `HTTP ${upstream.status}`, requestId }, upstream.status);
      }

      // Stream SSE through to the client
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Request-Id': requestId,
      });

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let chunks = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          chunks += 1;
          res.write(decoder.decode(value, { stream: true }));
        }
      } catch (streamErr) {
        logger.warn('ai.chat.stream_interrupted', {
          requestId,
          clientRequestId,
          provider,
          model,
          bytes,
          chunks,
          durationMs: Date.now() - startedAt,
          message: streamErr?.message || String(streamErr),
        });
      }
      res.end();
      logger.info('ai.chat.done', {
        requestId,
        clientRequestId,
        provider,
        model,
        bytes,
        chunks,
        durationMs: Date.now() - startedAt,
      });
      return;
    } catch (err) {
      logger.error('ai.chat.exception', {
        requestId,
        clientRequestId,
        provider,
        model,
        durationMs: Date.now() - startedAt,
        message: err?.message || String(err),
        stack: err?.stack,
      });
      return ctx.json({ error: err.message || 'AI request failed', requestId }, 502);
    }
  }

  // POST /api/ai/title — ALWAYS uses TITLE_MODEL. Client-sent provider/model
  // are ignored on purpose (see comment at top of file).
  if (path === '/api/ai/title' && method === 'POST') {
    const body = await ctx.body();
    const { userMessage } = body || {};
    const provider = TITLE_PROVIDER;
    const model = TITLE_MODEL;
    const apiKey = await getApiKey(provider);
    if (!apiKey) {
      logger.warn('ai.title.missing_key', { requestId, clientRequestId, provider });
      return ctx.json({ title: 'Untitled Story', requestId });
    }

    const endpoint = PROVIDER_ENDPOINTS[provider];
    const startedAt = Date.now();
    logger.info('ai.title.start', {
      requestId, clientRequestId, provider, model,
      userMessageChars: String(userMessage || '').length,
    });
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Generate a concise, creative story title (2-5 words) based on this message. Return only the title — no quotes, no punctuation at the end, no explanation.' },
            { role: 'user', content: userMessage },
          ],
        }),
      });
      if (!upstream.ok) {
        const err = await upstream.json().catch(() => ({}));
        logger.warn('ai.title.upstream_error', {
          requestId, provider, model, status: upstream.status,
          upstreamError: err?.error?.message || err,
        });
        return ctx.json({ title: 'Untitled Story', model, provider, requestId });
      }
      const data = await upstream.json();
      const title = String(data?.choices?.[0]?.message?.content || '').trim() || 'Untitled Story';
      logger.info('ai.title.done', {
        requestId, provider, model, titleChars: title.length,
        durationMs: Date.now() - startedAt,
      });
      return ctx.json({ title, model, provider, requestId });
    } catch (err) {
      logger.error('ai.title.exception', {
        requestId, provider, model,
        message: err?.message || String(err),
      });
      return ctx.json({ title: 'Untitled Story', model, provider, requestId });
    }
  }

  // POST /api/ai/image
  if (path === '/api/ai/image' && method === 'POST') {
    const body = await ctx.body();
    const { provider, model, prompt } = body || {};
    const apiKey = await getApiKey(provider);
    if (!apiKey) return ctx.json({ error: `No API key for ${provider}` }, 400);
    if (!model) return ctx.json({ error: 'No model specified' }, 400);

    const endpoint = PROVIDER_ENDPOINTS[provider] || PROVIDER_ENDPOINTS.openrouter;
    const startedAt = Date.now();

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: String(prompt) }],
          modalities: ['image', 'text'],
          image_config: { aspect_ratio: '16:9' },
          stream: false,
        }),
      });

      if (!upstream.ok) {
        const err = await upstream.json().catch(() => ({}));
        return ctx.json({ error: err?.error?.message || `HTTP ${upstream.status}` }, upstream.status);
      }

      const data = await upstream.json();
      const imageUrl = extractImageUrl(data);
      if (!imageUrl) {
        return ctx.json({ error: 'Model did not return an image' }, 422);
      }

      return ctx.json({
        imageUrl,
        model,
        provider,
        diagnosticCode: 'success',
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      return ctx.json({ error: err.message || 'Image generation failed' }, 502);
    }
  }

  // POST /api/ai/validate-key
  if (path === '/api/ai/validate-key' && method === 'POST') {
    const body = await ctx.body();
    const { provider, apiKey } = body || {};
    if (!apiKey) return ctx.json({ valid: false, error: 'No API key provided.' });

    // Use the auth-required endpoint — /v1/models is public and would accept
    // any gibberish key.
    const url = VALIDATE_KEY_ENDPOINTS[provider];
    if (!url) return ctx.json({ valid: false, error: `Unknown provider: ${provider}` });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const resp = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      clearTimeout(timeout);
      if (resp.ok) return ctx.json({ valid: true });
      if (resp.status === 401 || resp.status === 403) return ctx.json({ valid: false, error: 'Invalid API key.' });
      return ctx.json({ valid: false, error: `Provider returned HTTP ${resp.status}.` });
    } catch (err) {
      if (err?.name === 'AbortError') return ctx.json({ valid: false, error: 'Connection timed out.' });
      return ctx.json({ valid: false, error: err.message || 'Connection failed.' });
    }
  }

  // GET /api/ai/models?provider=X
  if (path === '/api/ai/models' && method === 'GET') {
    const provider = ctx.query.provider;
    const apiKey = await getApiKey(provider);
    if (!apiKey) return ctx.json([]);

    const url = MODEL_ENDPOINTS[provider];
    if (!url) return ctx.json([]);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const resp = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      clearTimeout(timeout);
      if (!resp.ok) return ctx.json([]);
      const data = await resp.json();
      const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const models = raw.map((m) => {
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
      }).filter((m) => m.id);
      return ctx.json(models);
    } catch {
      return ctx.json([]);
    }
  }

  return ctx.notFound();
}

function extractImageUrl(payload) {
  const images = payload?.choices?.[0]?.message?.images || [];
  for (const image of images) {
    const url = String(image?.image_url?.url || '').trim();
    if (url) return url;
  }
  return '';
}
