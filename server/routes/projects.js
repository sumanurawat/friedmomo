/**
 * /api/projects routes
 *
 * GET    /api/projects              — list projects (optional ?userId=)
 * POST   /api/projects              — create project
 * GET    /api/projects/:id          — load project
 * PUT    /api/projects/:id          — save/update project
 * DELETE /api/projects/:id          — delete project
 */

import * as store from '../fs-storage.js';

export async function handleProjects(ctx) {
  const { method, path } = ctx;

  // /api/projects
  if (path === '/api/projects') {
    if (method === 'GET') {
      const projects = await store.listProjects(ctx.query.userId);
      return ctx.json(projects);
    }
    if (method === 'POST') {
      const body = await ctx.body();
      if (!body || !body.id) return ctx.json({ error: 'project.id is required' }, 400);
      const saved = await store.saveProject(body);
      return ctx.json(saved, 201);
    }
    return ctx.json({ error: 'Method not allowed' }, 405);
  }

  // /api/projects/:id
  const match = path.match(/^\/api\/projects\/([^/]+)$/);
  if (!match) return ctx.notFound();
  const projectId = decodeURIComponent(match[1]);

  if (method === 'GET') {
    const project = await store.loadProject(projectId);
    if (!project) return ctx.json({ error: 'Project not found' }, 404);
    return ctx.json(project);
  }

  if (method === 'PUT' || method === 'PATCH') {
    const body = await ctx.body();
    const saved = await store.saveProject({ ...body, id: projectId });
    return ctx.json(saved);
  }

  if (method === 'DELETE') {
    const deleted = await store.deleteProject(projectId);
    return ctx.json({ deleted });
  }

  return ctx.json({ error: 'Method not allowed' }, 405);
}
