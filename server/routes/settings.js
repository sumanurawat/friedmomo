/**
 * /api/settings routes
 *
 * GET  /api/settings   — load settings
 * PUT  /api/settings   — save settings
 */

import * as store from '../fs-storage.js';

export async function handleSettings(ctx) {
  const { method, path } = ctx;

  if (path !== '/api/settings') return ctx.notFound();

  if (method === 'GET') {
    const settings = await store.loadSettings();
    return ctx.json(settings);
  }

  if (method === 'PUT' || method === 'POST') {
    const body = await ctx.body();
    await store.saveSettings(body || {});
    return ctx.json({ saved: true });
  }

  return ctx.json({ error: 'Method not allowed' }, 405);
}
