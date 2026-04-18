import { test, expect, openDemo } from './fixtures'

test('Ctrl+Shift+P toggles the perf overlay; metrics populate after messages', async ({
  page,
  eventSub,
}) => {
  const handle = await openDemo(page, eventSub)

  const overlay = page.getByRole('complementary', { name: /performance metrics/i })
  await expect(overlay).toHaveCount(0)

  // Toggle on.
  await page.keyboard.press('Control+Shift+P')
  await expect(overlay).toBeVisible()

  // All five metric rows exist (labels present regardless of numeric value).
  for (const label of ['Render', 'Virtualizer', 'DOM nodes', 'Heap', 'EventSub latency']) {
    await expect(overlay.getByText(label, { exact: false })).toBeVisible()
  }

  // Push 20 messages so messagesRenderedPerSec and eventSubLatencyMs accumulate non-zero values.
  for (let i = 0; i < 20; i++) {
    handle.pushChatMessage({ username: `perf_${i}`, userId: `uid_perf_${i}`, text: `msg ${i}` })
    await page.waitForTimeout(100)
  }

  // EventSub latency is sampled in the service; should settle > 0 ms (fixture timestamps are ~50ms in the past).
  await expect
    .poll(
      async () => {
        const text = await overlay.getByText(/ms$/i).first().textContent()
        const match = text?.match(/([\d.]+)\s*ms/i)
        return match ? Number(match[1]) : 0
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)

  // Toggle off — overlay unmounts.
  await page.keyboard.press('Control+Shift+P')
  await expect(overlay).toHaveCount(0)
})
