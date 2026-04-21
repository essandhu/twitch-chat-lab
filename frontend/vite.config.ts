/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Phase 10 note: `@xenova/transformers` is ONLY loaded via `import('@xenova/transformers')`
// inside `src/workers/embeddingWorker.ts`. Vite's default dynamic-import code-splitting
// lands that tree in its own chunk (look for `transformers-*.js` in `dist/assets/` after
// `npm run build`) so the main entry bundle does NOT pay the semantic-model tax at boot.
// Any static `import ... from '@xenova/transformers'` elsewhere would collapse the split —
// always prefer `import('…')` from the worker.
export default defineConfig({
  plugins: [react()],
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
