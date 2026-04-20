/**
 * Storyboarder local backend server.
 *
 * Provides a REST API on localhost:3001 backed by filesystem storage.
 * The frontend (Vite dev server) proxies /api/* requests here.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { initWorkspace, getWorkspace, setWorkspace } from './fs-storage.js';
import { handleProjects } from './routes/projects.js';
import { handleEntities } from './routes/entities.js';
import { handleImages } from './routes/images.js';
import { handleSettings } from './routes/settings.js';
import { handleAI } from './routes/ai.js';
import { handleLog } from './routes/log.js';
import { logger, getLogFilePath } from './logger.js';

const PORT = parseInt(process.env.STORYBOARDER_PORT || '3001', 10);

// When packaged in Electron, STORYBOARDER_STATIC_DIR points at the built Vite
// output. The server serves those assets as a fallback for non-API routes so
// the whole app (frontend + API) runs on a single port from the renderer's
// perspective. In `npm run dev:server`, this is unset and we only serve API
// — Vite handles the frontend on :4173 with its own proxy.
const STATIC_DIR = process.env.STORYBOARDER_STATIC_DIR
  ? resolve(process.env.STORYBOARDER_STATIC_DIR)
  : '';

// Allow custom workspace via env var
if (process.env.STORYBOARDER_WORKSPACE) {
  setWorkspace(process.env.STORYBOARDER_WORKSPACE);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico':  'image/x-icon',
  '.map':  'application/json',
  '.txt':  'text/plain; charset=utf-8',
};

/**
 * Serve a static asset from STATIC_DIR, or the SPA fallback (index.html)
 * for any unknown route so client-side routing works. Returns true if it
 * served a response, false if the path looks like an API call or STATIC_DIR
 * is unset.
 */
async function tryServeStatic(ctx) {
  if (!STATIC_DIR) return false;
  if (ctx.path.startsWith('/api/')) return false;
  const { res } = ctx;

  // Resolve the requested path safely inside STATIC_DIR (block traversal).
  const requested = ctx.path === '/' ? '/index.html' : ctx.path;
  const candidate = normalize(join(STATIC_DIR, requested));
  const insideStatic = candidate.startsWith(STATIC_DIR);

  try {
    if (insideStatic) {
      const st = await stat(candidate).catch(() => null);
      if (st && st.isFile()) {
        const body = await readFile(candidate);
        const mime = MIME_TYPES[extname(candidate).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=3600',
          'X-Request-Id': ctx.requestId,
        });
        res.end(body);
        return true;
      }
    }
    // SPA fallback — serve index.html for unmatched paths so client-side
    // routing keeps working if we ever add it.
    const index = join(STATIC_DIR, 'index.html');
    const body = await readFile(index);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Request-Id': ctx.requestId,
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tiny router helpers
// ---------------------------------------------------------------------------

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  json(res, { error: 'Not found' }, 404);
}

function cors(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Request-Id',
    'Access-Control-Expose-Headers': 'X-Request-Id',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return cors(res);

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const requestId = randomUUID();
  const clientRequestId = req.headers['x-client-request-id'] || null;
  const startedAt = Date.now();

  // Expose correlation id so the client can log it too
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');

  // One log line per completed request
  res.on('finish', () => {
    logger.info('http.request', {
      requestId,
      clientRequestId,
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  // Detect abrupt disconnects (client aborted / network dropped)
  res.on('close', () => {
    if (!res.writableEnded) {
      logger.warn('http.aborted', {
        requestId,
        clientRequestId,
        method: req.method,
        path,
        durationMs: Date.now() - startedAt,
      });
    }
  });

  // Context passed to all route handlers
  const ctx = {
    req,
    res,
    url,
    path,
    method: req.method,
    requestId,
    clientRequestId,
    logger,
    json: (data, status) => json(res, data, status),
    notFound: () => notFound(res),
    body: async () => parseBody(req),
    query: Object.fromEntries(url.searchParams),
  };

  try {
    // Route matching
    if (path.startsWith('/api/projects')) return await handleProjects(ctx);
    if (path.startsWith('/api/characters') || path.startsWith('/api/locations') || path.startsWith('/api/entities')) return await handleEntities(ctx);
    if (path.startsWith('/api/images')) return await handleImages(ctx);
    if (path.startsWith('/api/settings')) return await handleSettings(ctx);
    if (path.startsWith('/api/ai')) return await handleAI(ctx);
    if (path.startsWith('/api/log')) return await handleLog(ctx);

    // Health check
    if (path === '/api/health') {
      return ctx.json({ status: 'ok', workspace: getWorkspace() });
    }

    // In packaged Electron, serve the built frontend from STATIC_DIR.
    // Falls through to notFound() only when STATIC_DIR is unset (dev).
    if (await tryServeStatic(ctx)) return;

    return ctx.notFound();
  } catch (err) {
    logger.error('http.error', {
      requestId,
      clientRequestId,
      method: req.method,
      path,
      message: err?.message || String(err),
      stack: err?.stack,
    });
    json(res, { error: err.message || 'Internal server error', requestId }, 500);
  }
});

// Global process-level traps — anything that escapes a route still gets logged.
process.on('uncaughtException', (err) => {
  logger.error('process.uncaughtException', {
    message: err?.message || String(err),
    stack: err?.stack,
  });
});
process.on('unhandledRejection', (reason) => {
  logger.error('process.unhandledRejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack,
  });
});

// Start
async function start() {
  await initWorkspace();
  const logPath = await getLogFilePath();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Storyboarder] API server running at http://127.0.0.1:${PORT}`);
    console.log(`[Storyboarder] Workspace: ${getWorkspace()}`);
    console.log(`[Storyboarder] Log file:  ${logPath}`);
    console.log(`[Storyboarder] Tail with: tail -f "${logPath}"`);
    logger.info('server.start', { port: PORT, workspace: getWorkspace(), logPath });
  });
}

start().catch((err) => {
  console.error('[Storyboarder] Failed to start:', err);
  process.exit(1);
});
