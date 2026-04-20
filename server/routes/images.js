/**
 * /api/images routes
 *
 * GET    /api/images/:projectId/:filename   — serve image file
 * POST   /api/images/:projectId/:sceneId    — upload/save image
 * DELETE /api/images/:projectId/:sceneId    — delete image
 */

import { readFile } from 'node:fs/promises';
import * as store from '../fs-storage.js';

const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export async function handleImages(ctx) {
  const { method, path, res } = ctx;

  // /api/images/:projectId/:fileOrSceneId
  const match = path.match(/^\/api\/images\/([^/]+)\/([^/]+)$/);
  if (!match) return ctx.notFound();

  const projectId = decodeURIComponent(match[1]);
  const fileOrSceneId = decodeURIComponent(match[2]);

  if (method === 'GET') {
    // Serve image file
    const ext = fileOrSceneId.split('.').pop()?.toLowerCase() || 'png';
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const filePath = await store.resolveImagePath(projectId, fileOrSceneId);
    if (!filePath) return ctx.json({ error: 'Image not found' }, 404);

    try {
      const data = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch {
      return ctx.json({ error: 'Failed to read image' }, 500);
    }
    return;
  }

  if (method === 'POST') {
    // Save image (base64 body)
    const body = await ctx.body();
    if (!body?.imageData) return ctx.json({ error: 'imageData is required' }, 400);
    const url = await store.saveImage(projectId, fileOrSceneId, body.imageData);
    return ctx.json({ url }, 201);
  }

  if (method === 'DELETE') {
    const deleted = await store.deleteImage(projectId, fileOrSceneId);
    return ctx.json({ deleted });
  }

  return ctx.json({ error: 'Method not allowed' }, 405);
}
