/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// Phase 10 note: `@xenova/transformers` is ONLY loaded via `import('@xenova/transformers')`
// inside `src/workers/embeddingWorker.ts`. Vite's default dynamic-import code-splitting
// lands that tree in its own chunk (look for `transformers-*.js` in `dist/assets/` after
// `npm run build`) so the main entry bundle does NOT pay the semantic-model tax at boot.
// Any static `import ... from '@xenova/transformers'` elsewhere would collapse the split —
// always prefer `import('…')` from the worker.

// P11-11: dev-server middleware that exposes repo-root tests/fixtures/*.jsonl
// under the /tests/fixtures/* URL prefix so Playwright's replayFromFixture
// helper can GET them via Vite (which otherwise only serves from frontend/ +
// public/). Dev-only; production builds never include fixtures.
const fixtureServePlugin = (): Plugin => ({
  name: 'phase11-fixture-serve',
  configureServer(server) {
    server.middlewares.use('/tests/fixtures', (req, res) => {
      const relUrl = req.url ?? ''
      const cleanPath = relUrl.split('?')[0]?.replace(/^\//, '') ?? ''
      const absPath = resolve(__dirname, '..', 'tests', 'fixtures', cleanPath)
      try {
        statSync(absPath)
      } catch {
        res.statusCode = 404
        res.end()
        return
      }
      res.setHeader('Content-Type', 'application/x-ndjson')
      createReadStream(absPath).pipe(res)
    })
  },
})

export default defineConfig({
  plugins: [react(), fixtureServePlugin()],
  // Worker format must be ES so embeddingWorker.ts can `import('@xenova/transformers')`
  // dynamically — the default (iife) does not permit worker-chunk code splitting.
  worker: { format: 'es' },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Playwright lives in tests/e2e/ and is run via `npm run test:e2e`.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'tests/**', 'playwright-report/**', 'test-results/**'],
  },
})
