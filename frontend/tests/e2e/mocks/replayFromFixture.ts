import type { Page } from '@playwright/test'

// P11-11 — Playwright helper that boots the app in replay mode by mounting a
// committed JSONL fixture via `?replay=<path>`. Future specs (P11-19 and any
// subsequent phase) use this helper rather than ad-hoc WebSocket mocks
// (see architecture-review.md:67). Existing Phase 6/8/9/10 specs remain on
// the WebSocket mock at mocks/eventsub.ts — they pre-date Phase 11's
// convergence pattern and are structurally stable.
//
// Usage:
//
//     await replayFromFixture(page, 'tests/fixtures/phase-10-recording.jsonl')
//     await expect(page.getByTestId('scrub-bar')).toBeVisible()
//
// The fixture must conform to the Phase 11 canonical schema (validated by
// tests/fixtures/validateSchema.test.mjs).

interface ReplayOptions {
  extraParams?: Record<string, string>
  waitForScrubBar?: boolean
}

export const replayFromFixture = async (
  page: Page,
  fixturePath: string,
  options: ReplayOptions = {},
): Promise<void> => {
  const params = new URLSearchParams()
  params.set('replay', fixturePath)
  for (const [k, v] of Object.entries(options.extraParams ?? {})) params.set(k, v)

  // The dev server serves files from `/tests/fixtures/*` via Vite's static
  // handler (or the test harness's equivalent). Playwright navigates to `/?...`
  // and the in-app replayBoot fetches the fixture relative to origin.
  await page.goto(`/?${params.toString()}`)

  if (options.waitForScrubBar !== false) {
    await page.getByTestId('scrub-bar').waitFor({ state: 'visible', timeout: 10_000 })
  }
}
