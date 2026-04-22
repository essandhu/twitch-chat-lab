import { test, expect, openDemo } from './fixtures'
import { installProxyRoutes } from './mocks/proxy'

test('intelligence dock: "All streams" option merges signals across streams with per-row badges', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(90_000)
  const proxy = await installProxyRoutes(page)

  await openDemo(page, eventSub)

  await expect(page.getByRole('button', { name: /compare streams/i })).toBeEnabled({
    timeout: 15_000,
  })
  await page.getByRole('button', { name: /compare streams/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })

  const selectBoxes = page.getByRole('checkbox', { name: /select /i })
  await expect(selectBoxes).toHaveCount(5, { timeout: 10_000 })
  await selectBoxes.nth(0).click()
  await selectBoxes.nth(1).click()
  await page.getByRole('button', { name: /^compare$/i }).click()

  const proxyHandle = await proxy.wsOpened
  await expect(page.getByRole('button', { name: /exit multi-stream mode/i })).toBeVisible()

  // Push question-style messages into each stream so Questions signals populate per-stream.
  proxyHandle.pushChat('demouser', 'is this a question?', 'viewer1')
  proxyHandle.pushChat('alt_one', 'what did you just say?', 'viewer2')
  proxyHandle.pushChat('alt_two', 'why is that happening?', 'viewer3')

  // Open Intelligence tab in the dock.
  const dock = page.getByTestId('intelligence-panel').locator('..')
  const intelTab = page.getByRole('tab', { name: /intelligence/i })
  await intelTab.click()

  const selector = page.getByLabel('Stream selector for intelligence panel')
  await expect(selector).toBeVisible()

  // Verify the dropdown has an "All streams" option.
  const options = await selector.locator('option').allTextContents()
  expect(options[0]).toMatch(/all streams/i)
  expect(options.length).toBeGreaterThanOrEqual(4)

  // Select "All streams".
  await selector.selectOption({ label: 'All streams' })

  // Switch to Questions tab (default) — verify badges appear.
  const questionsTab = page.getByRole('tab', { name: /questions/i })
  await questionsTab.click()

  const badges = page.getByTestId('intelligence-row-stream-badge')
  await expect(badges.first()).toBeVisible({ timeout: 10_000 })
  const badgeCount = await badges.count()
  expect(badgeCount).toBeGreaterThanOrEqual(2) // at least 2 different streams contributed

  // Screenshot (a): dropdown open showing "All streams" — we can't easily open <select>
  // in Chromium headlessly, so take a screenshot of the intelligence panel in "All" mode.
  await page.screenshot({ path: 'test-results/intel-screens/intel-all-streams-questions.png', fullPage: false })

  // Switch to Semantic tab — selector should HIDE.
  const semanticTab = page.getByRole('tab', { name: /semantic/i })
  await semanticTab.click()
  await expect(selector).toBeHidden()
  await page.screenshot({ path: 'test-results/intel-screens/intel-semantic-no-selector.png', fullPage: false })

  // Switch back to Questions — selector reappears.
  await questionsTab.click()
  await expect(selector).toBeVisible()
  await page.screenshot({ path: 'test-results/intel-screens/intel-questions-selector-back.png', fullPage: false })
})
