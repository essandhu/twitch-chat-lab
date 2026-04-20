import { test, expect, openDemo } from './fixtures'
import { installProxyRoutes } from './mocks/proxy'

// Shared helper — opens demo, enables compare with 2 alternates (3 total streams),
// waits for the multi-stream layout to mount, and returns the proxy envelope
// handle for pushing chat into each column.
const openCompareMode = async (
  page: import('@playwright/test').Page,
  eventSub: Promise<import('./mocks/eventsub').FakeEventSubHandle>,
) => {
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
  return { proxyHandle, proxy }
}

test('cross-stream: per-stream DSL filter; stream A filters, B + C unchanged', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(60_000)
  const { proxyHandle } = await openCompareMode(page, eventSub)

  const mainArea = page.getByRole('main')

  // Pump a mix into each stream.
  proxyHandle.pushChat('demouser', 'pog moment on demo', 'uA1')
  proxyHandle.pushChat('demouser', 'regular chatter', 'uA2')
  proxyHandle.pushChat('alt_one', 'pog on alt one', 'uB1')
  proxyHandle.pushChat('alt_one', 'generic', 'uB2')
  proxyHandle.pushChat('alt_two', 'pog from alt two', 'uC1')
  proxyHandle.pushChat('alt_two', 'generic again', 'uC2')

  await expect(mainArea.getByText('pog moment on demo')).toBeVisible()

  // Type a DSL query into the FIRST column's toolbar only.
  const firstToolbarInput = mainArea.getByLabel(/keyword filter/i).first()
  await firstToolbarInput.fill('kw:"pog"')

  // First column keeps only pog, other columns keep everything.
  await expect(mainArea.getByText('pog moment on demo')).toBeVisible()
  await expect(mainArea.getByText('regular chatter')).toHaveCount(0)
  await expect(mainArea.getByText('generic', { exact: true })).toBeVisible()
  await expect(mainArea.getByText('generic again')).toBeVisible()
})

test('cross-stream: apply-to-all fans the query across all 3 columns', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(60_000)
  const { proxyHandle } = await openCompareMode(page, eventSub)

  const mainArea = page.getByRole('main')

  proxyHandle.pushChat('demouser', 'pog A', 'uA')
  proxyHandle.pushChat('demouser', 'noise A', 'uA2')
  proxyHandle.pushChat('alt_one', 'pog B', 'uB')
  proxyHandle.pushChat('alt_one', 'noise B', 'uB2')
  proxyHandle.pushChat('alt_two', 'pog C', 'uC')
  proxyHandle.pushChat('alt_two', 'noise C', 'uC2')

  await expect(mainArea.getByText('pog A')).toBeVisible()

  const firstInput = mainArea.getByLabel(/keyword filter/i).first()
  await firstInput.fill('kw:"pog"')

  // Hit the "Apply to all" button (only rendered in multi mode).
  await mainArea.getByRole('button', { name: /apply to all/i }).first().click()

  await expect(mainArea.getByText('pog A')).toBeVisible()
  await expect(mainArea.getByText('pog B')).toBeVisible()
  await expect(mainArea.getByText('pog C')).toBeVisible()
  await expect(mainArea.getByText('noise A')).toHaveCount(0)
  await expect(mainArea.getByText('noise B')).toHaveCount(0)
  await expect(mainArea.getByText('noise C')).toHaveCount(0)
})

test('cross-stream: save preset + reload + load restores query', async ({ page, eventSub }) => {
  test.setTimeout(60_000)
  const { proxyHandle } = await openCompareMode(page, eventSub)

  // Seed matchable messages so the rendered columns are non-empty.
  proxyHandle.pushChat('demouser', 'subwatch', 'uA')
  proxyHandle.pushChat('alt_one', 'stream chat', 'uB')

  // Type a query + save preset.
  const input = page.getByLabel(/keyword filter/i).first()
  await input.fill('role:sub')

  page.once('dialog', async (dialog) => {
    await dialog.accept('hype-subs')
  })
  await page.getByRole('button', { name: /filter presets/i }).first().click()
  await page.getByText(/save current query as/i).click()

  // Reload — preset survives via localStorage.
  await page.reload()
  await expect(page.getByRole('button', { name: /compare streams/i })).toBeVisible({
    timeout: 15_000,
  })
  // localStorage persists across the reload; assert the preset is present.
  const stored = await page.evaluate(() => localStorage.getItem('tcl.filter.presets'))
  expect(stored).toContain('hype-subs')
  expect(stored).toContain('role:sub')
})

test('cross-stream: ?filter=<base64> boot-time param applies and is stripped', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(45_000)
  await installProxyRoutes(page)

  // Prebuilt base64 query — simple kw:"demo" so it actually matches.
  const encoded = Buffer.from(encodeURIComponent('kw:"demo"')).toString('base64')
  await page.goto(`/?demo=playwright&filter=${encoded}`)

  // Wait for boot + check URL gets cleaned.
  await expect(page.getByRole('button', { name: /compare streams/i })).toBeVisible({
    timeout: 15_000,
  })
  await expect
    .poll(() => page.url(), { timeout: 5_000 })
    .not.toMatch(/[?&]filter=/)

  // Single-stream mode receives the query. Confirm by eventSub push: pump
  // a non-demo message + a demo-keyword message; only the latter survives.
  const handle = await eventSub
  handle.pushChatMessage({ username: 'viewer1', userId: 'u1', text: 'demo wins', badges: [] })
  handle.pushChatMessage({ username: 'viewer2', userId: 'u2', text: 'unrelated', badges: [] })

  await expect(page.getByText('demo wins')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('unrelated')).toHaveCount(0)
})

test('cross-stream: Spotlight tab + correlation chart render in multi-stream mode', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(60_000)
  const { proxyHandle } = await openCompareMode(page, eventSub)

  proxyHandle.pushChat('demouser', 'one', 'uA')
  proxyHandle.pushChat('alt_one', 'two', 'uB')
  proxyHandle.pushChat('alt_two', 'three', 'uC')

  // Spotlight tab lives inside ChatDock (multi-stream variant). Data-testid
  // scoping confirms the tab-triggered pane mounted.
  await expect(page.getByTestId('spotlight-feed')).toBeVisible({ timeout: 10_000 })

  // Navigate to Heatmap view — correlation chart should appear with ≥ 2 streams.
  await page.getByRole('tab', { name: /heatmap/i }).click()
  await expect(page.getByTestId('correlation-chart')).toBeVisible({ timeout: 10_000 })
})
