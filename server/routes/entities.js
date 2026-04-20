/**
 * /api/characters and /api/locations routes
 *
 * GET    /api/characters            — list all characters
 * POST   /api/characters            — create character
 * GET    /api/characters/:id        — load character
 * PUT    /api/characters/:id        — update character
 * DELETE /api/characters/:id        — delete character
 *
 * GET    /api/locations             — list all locations
 * POST   /api/locations             — create location
 * GET    /api/locations/:id         — load location
 * PUT    /api/locations/:id         — update location
 * DELETE /api/locations/:id         — delete location
 *
 * GET    /api/entities/story/:storyId          — get entities linked to a story
 * POST   /api/entities/story/:storyId/link     — link entity to story
 * POST   /api/entities/story/:storyId/unlink   — unlink entity from story
 */

import * as store from '../fs-storage.js';

export async function handleEntities(ctx) {
  const { method, path } = ctx;

  // --- Characters ---

  if (path === '/api/characters') {
    if (method === 'GET') {
      const characters = await store.listCharacters(ctx.query.userId);
      return ctx.json(characters);
    }
    if (method === 'POST') {
      const body = await ctx.body();
      if (!body || !body.id) return ctx.json({ error: 'character.id is required' }, 400);
      const saved = await store.saveCharacter(body);
      return ctx.json(saved, 201);
    }
    return ctx.json({ error: 'Method not allowed' }, 405);
  }

  const charMatch = path.match(/^\/api\/characters\/([^/]+)$/);
  if (charMatch) {
    const id = decodeURIComponent(charMatch[1]);
    if (method === 'GET') {
      const character = await store.loadCharacter(id);
      if (!character) return ctx.json({ error: 'Character not found' }, 404);
      return ctx.json(character);
    }
    if (method === 'PUT' || method === 'PATCH') {
      const body = await ctx.body();
      const saved = await store.saveCharacter({ ...body, id });
      return ctx.json(saved);
    }
    if (method === 'DELETE') {
      const deleted = await store.deleteCharacter(id);
      return ctx.json({ deleted });
    }
    return ctx.json({ error: 'Method not allowed' }, 405);
  }

  // --- Locations ---

  if (path === '/api/locations') {
    if (method === 'GET') {
      const locations = await store.listLocations(ctx.query.userId);
      return ctx.json(locations);
    }
    if (method === 'POST') {
      const body = await ctx.body();
      if (!body || !body.id) return ctx.json({ error: 'location.id is required' }, 400);
      const saved = await store.saveLocation(body);
      return ctx.json(saved, 201);
    }
    return ctx.json({ error: 'Method not allowed' }, 405);
  }

  const locMatch = path.match(/^\/api\/locations\/([^/]+)$/);
  if (locMatch) {
    const id = decodeURIComponent(locMatch[1]);
    if (method === 'GET') {
      const location = await store.loadLocation(id);
      if (!location) return ctx.json({ error: 'Location not found' }, 404);
      return ctx.json(location);
    }
    if (method === 'PUT' || method === 'PATCH') {
      const body = await ctx.body();
      const saved = await store.saveLocation({ ...body, id });
      return ctx.json(saved);
    }
    if (method === 'DELETE') {
      const deleted = await store.deleteLocation(id);
      return ctx.json({ deleted });
    }
    return ctx.json({ error: 'Method not allowed' }, 405);
  }

  // --- Story-entity links ---

  const storyEntMatch = path.match(/^\/api\/entities\/story\/([^/]+)$/);
  if (storyEntMatch && method === 'GET') {
    const storyId = decodeURIComponent(storyEntMatch[1]);
    const entities = await store.loadStoryEntities(storyId);
    return ctx.json(entities);
  }

  const linkMatch = path.match(/^\/api\/entities\/story\/([^/]+)\/(link|unlink)$/);
  if (linkMatch && method === 'POST') {
    const storyId = decodeURIComponent(linkMatch[1]);
    const action = linkMatch[2];
    const body = await ctx.body();
    if (!body?.entityType || !body?.entityId) {
      return ctx.json({ error: 'entityType and entityId required' }, 400);
    }
    if (action === 'link') {
      const result = await store.linkEntityToStory(storyId, body.entityType, body.entityId);
      return ctx.json({ linked: result });
    } else {
      const result = await store.unlinkEntityFromStory(storyId, body.entityType, body.entityId);
      return ctx.json({ unlinked: result });
    }
  }

  return ctx.notFound();
}
