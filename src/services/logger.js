/**
 * Frontend logger — mirrors events to the browser console and ships them
 * to /api/log on the backend so every error is captured in one tail-able
 * stream (locally: <workspace>/logs/storyboarder.jsonl; in prod: backend
 * log drain).
 *
 * Usage:
 *   import { logger, installGlobalErrorHandlers } from './services/logger.js';
 *   logger.info('chat.send', { model, messageCount });
 *   logger.error('chat.timeout', { provider, model, lastChunkAgoMs });
 *
 * Design:
 *   - Fire-and-forget POSTs, batched with a 500ms debounce.
 *   - Never throws. If the backend is unreachable, events are re-queued.
 *   - Session id + sequence number attached to every entry for ordering.
 */

import { IS_WEB } from './platform.js';

const SESSION_ID = (() => {
  try {
    const existing = sessionStorage.getItem('sb-session-id');
    if (existing) return existing;
    const id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));
    sessionStorage.setItem('sb-session-id', id);
    return id;
  } catch {
    return String(Date.now());
  }
})();

let seq = 0;
let queue = [];
let flushTimer = null;
let flushing = false;

const FLUSH_DEBOUNCE_MS = 500;
const MAX_BATCH = 50;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

async function flush() {
  flushTimer = null;
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, MAX_BATCH);

  // In the web build there is no /api/log endpoint. The console has already
  // captured every event via emit(); just discard the batch so the queue
  // doesn't grow forever.
  if (IS_WEB) {
    flushing = false;
    return;
  }

  try {
    const res = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    // Backend unreachable — put them back at the head of the queue so we retry.
    queue.unshift(...batch);
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

function emit(level, event, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    sessionId: SESSION_ID,
    seq: ++seq,
    url: typeof location !== 'undefined' ? location.pathname + location.search : undefined,
    ...sanitize(fields),
  };

  // Mirror to console so devtools shows it with the rest of the app's logs
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn.call(console, `[${event}]`, fields);

  queue.push(entry);
  scheduleFlush();
}

function sanitize(fields) {
  // Strip things that shouldn't leave the client (API keys etc.)
  // and serialize Error objects.
  if (!fields || typeof fields !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/apikey|api_key|authorization|password|secret|token/i.test(k)) {
      out[k] = '[REDACTED]';
      continue;
    }
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: v.stack };
      continue;
    }
    out[k] = v;
  }
  return out;
}

export const logger = {
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
};

export function getSessionId() {
  return SESSION_ID;
}

/**
 * Catch errors that never reached explicit try/catch blocks.
 * Call once at app startup.
 */
export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (e) => {
    logger.error('window.error', {
      message: e.message,
      filename: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    logger.error('unhandled.rejection', {
      message: reason?.message || String(reason),
      stack: reason?.stack,
    });
  });

  // Flush remaining events on tab close — keepalive fetch allows this.
  // In the web build there is no /api/log endpoint, so skip.
  if (IS_WEB) return;

  window.addEventListener('pagehide', () => {
    if (queue.length === 0) return;
    try {
      const payload = JSON.stringify({ events: queue.splice(0, queue.length) });
      // navigator.sendBeacon is ideal for unload but does not support JSON content-type
      // well across browsers; keepalive fetch is our primary exit path.
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // ignore
    }
  });
}
