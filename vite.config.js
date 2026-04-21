import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Two build modes:
 *   - electron (default): assets referenced relatively, outputs to dist/,
 *     talks to the local Node backend on /api/*.
 *   - web: assets served from /app/ on friedmomo.com, outputs to dist-web/,
 *     AI + storage talk directly to OpenRouter / IndexedDB.
 *
 * The mode is read from VITE_STORYBOARDER_MODE. See src/services/platform.js.
 *
 * The backend-vs-browser implementation is swapped via resolve.alias so the
 * unused half is never bundled — a ternary dispatch would import both and
 * defeat tree-shaking.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const storyboarderMode = (
    process.env.VITE_STORYBOARDER_MODE ||
    env.VITE_STORYBOARDER_MODE ||
    'electron'
  ).toLowerCase()
  const isWeb = storyboarderMode === 'web'

  const aiImpl = isWeb
    ? resolve(__dirname, 'src/services/ai-direct.js')
    : resolve(__dirname, 'src/services/ai-backend.js')
  const storageImpl = isWeb
    ? resolve(__dirname, 'src/services/storage-idb.js')
    : resolve(__dirname, 'src/services/storage-backend.js')

  return {
    base: isWeb ? '/app/' : './',
    plugins: [react()],
    build: {
      outDir: isWeb ? 'dist-web' : 'dist',
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@ai-impl': aiImpl,
        '@storage-impl': storageImpl,
      },
    },
    // Expose the resolved mode to client code via import.meta.env.
    define: {
      'import.meta.env.VITE_STORYBOARDER_MODE': JSON.stringify(storyboarderMode),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  }
})
