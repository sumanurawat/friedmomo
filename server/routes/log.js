/**
 * /api/log — accepts structured events from the frontend and writes them
 * into the same logger stream as backend events. Mark as source=client
 * so log consumers can distinguish.
 */

import { logger } from '../logger.js';

export async function handleLog(ctx) {
  if (ctx.method !== 'POST' || ctx.path !== '/api/log') {
    return ctx.notFound();
  }

  const body = await ctx.body();
  const events = Array.isArray(body?.events)
    ? body.events
    : body && typeof body === 'object'
      ? [body]
      : [];

  for (const e of events) {
    const level = ['info', 'warn', 'error'].includes(e?.level) ? e.level : 'info';
    const event = e?.event || 'client.event';
    const { level: _l, event: _e, ...rest } = e || {};
    const fields = { source: 'client', requestId: ctx.requestId, ...rest };
    logger[level](event, fields);
  }

  return ctx.json({ ok: true, count: events.length, requestId: ctx.requestId });
}
