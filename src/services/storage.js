/**
 * Storage facade — the actual implementation is picked at build time via the
 * `@storage-impl` alias in vite.config.js:
 *
 *   - electron build: ./storage-backend.js (talks to /api/* on localhost)
 *   - web build:      ./storage-idb.js     (IndexedDB in the browser)
 *
 * Only the chosen implementation is bundled. Stores and components should
 * import from this file so platform branching stays invisible to them.
 */
export * from '@storage-impl';
