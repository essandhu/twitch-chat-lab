import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Config for the README media capture suite (capture.spec.ts). Kept separate
 * from tests/e2e/playwright.config.ts because capture runs are sequential by
 * design — the staged sessions build wall-clock heatmap history and record
 * video, so parallel workers would contend for CPU and jitter the GIF.
 *
 * Run via `node docs/media/capture.mjs` or `npm run capture:media`.
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: resolve(HERE, '../..'),
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120_000,
    env: {
      // Same deterministic env the E2E config uses — routes intercept by URL,
      // the values themselves never reach a real service.
      VITE_PROXY_URL: 'http://localhost:8080',
      VITE_TWITCH_CLIENT_ID: 'playwright-fixture-client-id',
    },
  },
})
