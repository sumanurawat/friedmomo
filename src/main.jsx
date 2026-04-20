import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installGlobalErrorHandlers, logger } from './services/logger.js'

// Capture anything that slips past explicit try/catch — reported to /api/log.
installGlobalErrorHandlers();
logger.info('app.boot', {
  userAgent: navigator.userAgent,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
});

createRoot(document.getElementById('root')).render(
  <App />,
)
