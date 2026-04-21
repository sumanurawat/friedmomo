import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installGlobalErrorHandlers, logger } from './services/logger.js'
import { IS_WEB } from './services/platform.js'

// Capture anything that slips past explicit try/catch — reported to /api/log.
installGlobalErrorHandlers();
logger.info('app.boot', {
  mode: IS_WEB ? 'web' : 'electron',
  userAgent: navigator.userAgent,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
});

// Register the service worker only in the web build. Electron never wants one
// (it could intercept http://127.0.0.1:port/... in unexpected ways), and the
// SW is what makes the PWA installable. The env check is resolved at build
// time (see vite.config.js `define`) so the entire block disappears from the
// electron bundle rather than becoming a dead `if (false)`.
if (import.meta.env.VITE_STORYBOARDER_MODE === 'web' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI).toString();
    navigator.serviceWorker.register(swUrl).then(
      (reg) => logger.info('sw.registered', { scope: reg.scope }),
      (err) => logger.warn('sw.register_failed', { message: err?.message || String(err) }),
    );
  });
}

createRoot(document.getElementById('root')).render(
  <App />,
)
