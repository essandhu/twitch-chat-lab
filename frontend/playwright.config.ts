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
  // P11-23 — visual-regression tolerance. The previous pre-Phase-11 default
  // of zero tolerance on toHaveScreenshot() produced flaky failures on the
  // Phase 10 MomentsTimeline (pulsing icons) and the Phase 11 ScrubBar
  // (thumb focus ring, Moments-tick colors). The 0.2 threshold + 0.01
  // maxDiffPixelRatio is the P8-spec-sanctioned relaxation for animated
  // surfaces, applied project-wide now that Phase 11 ships the final UI.
  // Specs that need stricter tolerance (shell, static layouts) continue to
  // pass the explicit maxDiffPixels override at the call site.
  expect: {
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
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
