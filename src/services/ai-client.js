/**
 * AI client — facade. The actual implementation is picked at build time via
 * the `@ai-impl` alias in vite.config.js:
 *
 *   - electron build: ./ai-backend.js (talks to /api/ai/* on localhost)
 *   - web build:      ./ai-direct.js  (talks to OpenRouter from the browser)
 *
 * Only the chosen implementation is bundled. Stores and components should
 * import from this file so platform branching stays invisible to them.
 */
export * from '@ai-impl';
