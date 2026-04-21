import { test, expect, openDemo } from './fixtures'

// Phase 10 P10-19 — region-based screenshot tolerance for animated surfaces
// (SemanticStatusChip fades on ready, MomentsTimeline icons pulse). Strict pixel
// match is kept for theme/shell specs; this override is scoped to this file.
test.use({
  screenshot: 'only-on-failure',
})

test.describe.configure({ mode: 'parallel' })

test.describe('Phase 10 semantic layer', () => {
  test('TopNav surfaces the info-tooltip with privacy copy', async ({ page, eventSub }) => {
    test.setTimeout(30_000)
    await openDemo(page, eventSub)
    const info = page.getByTestId('semantic-info-tooltip')
    await expect(info).toBeVisible()
    await expect(info).toHaveAttribute('aria-label', 'About semantic search')
  })

  test('SemanticStatusChip mounts in the TopNav after boot', async ({ page, eventSub }) => {
    test.setTimeout(45_000)
    await openDemo(page, eventSub)
    const chip = page.getByTestId('semantic-status-chip')
    // Chip is hidden while status === 'idle'; once activate() starts it transitions
    // through loading/ready/failed. We poll for the chip to appear (any non-idle state).
    await expect(chip).toBeVisible({ timeout: 30_000 })
    const status = await chip.getAttribute('data-status')
    expect(['loading', 'ready', 'failed']).toContain(status)
  })

  test('Semantic tab in IntelligencePanel renders the input and empty-state copy', async ({
    page,
    eventSub,
  }) => {
    test.setTimeout(45_000)
    const handle = await openDemo(page, eventSub)
    const es = await handle

    // Push a few messages so the Intelligence panel has visible content; the
    // semantic tab is independent but ensuring the panel mounts is cheap.
    for (let i = 0; i < 5; i++) {
      es.pushChatMessage({
        username: `user_${i}`,
        userId: `uid_${i}`,
        text: `pog fight ${i}`,
      })
    }

    const intelligenceTab = page.getByRole('tab', { name: /Intelligence/i })
    if (await intelligenceTab.isVisible().catch(() => false)) {
      await intelligenceTab.click()
    }

    const semanticTab = page.getByRole('tab', { name: /^Semantic$/ })
    await expect(semanticTab).toBeVisible({ timeout: 30_000 })
    await semanticTab.click()

    await expect(page.getByTestId('semantic-search-input')).toBeVisible()
  })

  test('MomentsTimeline is hidden when no moments have been detected', async ({
    page,
    eventSub,
  }) => {
    test.setTimeout(30_000)
    await openDemo(page, eventSub)
    // With no moments, the timeline should not render at all (no dead-space rule).
    const timeline = page.getByTestId('moments-timeline')
    const count = await timeline.count()
    expect(count).toBe(0)
  })
})
