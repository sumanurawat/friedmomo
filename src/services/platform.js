/**
 * Platform detection — which runtime are we in?
 *
 * Two modes:
 *   - 'electron': the app runs inside Electron (or Vite dev against the local
 *     Node backend). AI calls and storage I/O go through the /api/* backend.
 *   - 'web': the app runs in a plain browser, deployed to GitHub Pages (or any
 *     static host). There is NO backend. AI calls go directly to OpenRouter
 *     using the user's key from localStorage; storage lives in IndexedDB.
 *
 * The mode is set at build time via `VITE_STORYBOARDER_MODE`. Defaulting to
 * 'electron' preserves the existing desktop build. `npm run build:web` flips
 * the flag and produces the PWA bundle.
 */

const RAW_MODE = (import.meta.env?.VITE_STORYBOARDER_MODE || 'electron').toLowerCase();

export const STORYBOARDER_MODE = RAW_MODE === 'web' ? 'web' : 'electron';
export const IS_WEB = STORYBOARDER_MODE === 'web';
export const IS_ELECTRON = STORYBOARDER_MODE === 'electron';
