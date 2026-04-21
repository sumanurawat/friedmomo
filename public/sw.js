/**
 * Storyboarder service worker — minimal.
 *
 * Goals:
 *   - Make the app installable and offline-launchable (the shell comes from
 *     cache when the network is unreachable).
 *   - Never intercept OpenRouter calls — those must always hit the network
 *     so streaming works and the user sees real errors instead of stale ones.
 *   - Never cache anything dynamic (API calls, images we'd eventually
 *     regenerate) — the app manages its own state via IndexedDB.
 *
 * Strategy:
 *   - Precache a tiny shell on install (index + manifest + the root icons).
 *   - Runtime: network-first for same-origin navigations, cache-fallback for
 *     the shell. Everything else passes through untouched.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `storyboarder-shell-${CACHE_VERSION}`;

// Paths are resolved against the SW scope (which is the `/app/` path in web
// production). Relative entries keep us portable to local preview.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(SHELL_ASSETS).catch(() => {
        // Partial precache is fine — the offline story degrades gracefully.
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('storyboarder-shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch cross-origin requests (OpenRouter, fonts, etc.).
  if (url.origin !== self.location.origin) return;

  // Never touch the dev / Electron API surface — if it's ever hit, pass through.
  if (url.pathname.startsWith('/api/')) return;

  // For HTML navigation: network-first, fall back to the cached shell so the
  // app still opens offline. The SPA hydrates from IndexedDB after boot.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() =>
          caches.match('./index.html').then((cached) => cached || Response.error()),
        ),
    );
    return;
  }

  // For the other shell assets: cache-first with background update.
  if (SHELL_ASSETS.some((asset) => url.pathname.endsWith(asset.replace('./', '/')))) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
  // Everything else (hashed JS/CSS bundles): let the browser handle it
  // normally. Vite fingerprints these so cache correctness comes for free.
});
