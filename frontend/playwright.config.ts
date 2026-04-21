import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  // Static, OS-independent path for committed visual-regression baselines.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  // P11-23 — visual-regression tolerance. The 0.2 threshold is the P8-spec-
  // sanctioned relaxation for font-antialiasing noise and animated surfaces
  // (Phase 10 MomentsTimeline, Phase 11 ScrubBar). Each call site keeps its
  // explicit `maxDiffPixels` budget — the shell capture uses 2,500, section
  // captures use 1,000. An earlier draft also set maxDiffPixelRatio: 0.01
  // globally, but for small section crops (top-nav at ~100k pixels) 1,000
  // diff-pixels already exceeds the 0.01 ratio on benign font-rendering
  // noise, so the ratio gate defaults back to Playwright's 1.0 and per-call
  // absolute budgets do the filtering.
  expect: {
    toHaveScreenshot: {
      threshold: 0.2,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120_000,
    env: {
      // Deterministic proxy URL for E2E fixture routing.
      VITE_PROXY_URL: 'http://localhost:8080',
      // Deterministic client_id so Helix/EventSub requests include the header
      // (routes intercept by URL; the header content does not matter).
      VITE_TWITCH_CLIENT_ID: 'playwright-fixture-client-id',
    },
  },
})
