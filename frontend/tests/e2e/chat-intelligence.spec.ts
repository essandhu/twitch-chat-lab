import { test, expect, openDemo } from './fixtures'
import { installProxyRoutes } from './mocks/proxy'

const COPYPASTA = 'HAHAHA COPYPASTA GO BRRRR yes'

const pushBurst = (
  handle: Awaited<ReturnType<typeof openDemo>> extends Promise<infer T> ? T : never,
): void => {
  for (let i = 0; i < 40; i++) {
    handle.pushChatMessage({
      username: `raider_${i}`,
      userId: `uid_raider_${i}`,
      text: COPYPASTA,
    })
  }
}

test('single-stream: RaidRiskChip elevates after copypasta burst, tooltip + popover render', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(60_000)
  const handle = await openDemo(page, eventSub)
  const es = await handle

  // Chip starts calm.
  await expect(page.getByTestId('raid-risk-chip')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('raid-risk-chip')).toHaveAttribute('data-band', 'calm')

  // Push a varied baseline first so similarity doesn't spuriously fire.
  const baseline = [
    'hey chat nice stream',
    'this game is great',
    'what a moment',
    'i agree with that call',
    'gg well played',
  ]
  for (let i = 0; i < baseline.length; i++) {
    es.pushChatMessage({ username: `user_${i}`, userId: `u_${i}`, text: baseline[i] })
  }

  // Now push the burst.
  pushBurst(es)

  // Poll until the chip leaves 'calm' — ≤ ~6s for the 1 Hz tick loop.
  await expect
    .poll(
      async () => (await page.getByTestId('raid-risk-chip').getAttribute('data-band')) ?? 'calm',
      { timeout: 10_000 },
    )
    .not.toBe('calm')

  // Click → popover opens with 4 component score labels + 4 sparklines.
  await page.getByTestId('raid-risk-chip').click()
  const popover = page.getByTestId('raid-risk-popover')
  await expect(popover).toBeVisible({ timeout: 5_000 })
  await expect(popover.getByText('similarityBurst').first()).toBeVisible()
  await expect(popover.getByText('lexicalDiversityDrop').first()).toBeVisible()
  await expect(popover.getByText('emoteVsTextRatio').first()).toBeVisible()
  await expect(popover.getByText('newChatterInflux').first()).toBeVisible()
  const sparklines = popover.locator('svg')
  await expect(sparklines).toHaveCount(4)
})

test('single-stream: IntelligencePanel populates question/callout/bits tabs', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(60_000)
  const handle = await openDemo(page, eventSub)
  const es = await handle

  await expect(page.getByRole('tab', { name: /chat/i })).toBeVisible({ timeout: 10_000 })

  // Seed 3 questions, 2 callouts, 1 bits message.
  es.pushChatMessage({ username: 'q1', userId: 'q1', text: 'how do you hit that shot' })
  es.pushChatMessage({ username: 'q2', userId: 'q2', text: 'why is this so hard today' })
  es.pushChatMessage({ username: 'q3', userId: 'q3', text: 'what time does the next match start?' })
  es.pushChatMessage({ username: 'c1', userId: 'c1', text: 'hey @demouser keep it up' })
  es.pushChatMessage({ username: 'c2', userId: 'c2', text: 'gg @demouser nice play' })
  es.pushCheer({ username: 'b1', userId: 'b1', text: 'cheer100 thanks streamer', bits: 100 })

  // Switch to Intelligence tab.
  await page.getByRole('tab', { name: /intelligence/i }).click()

  await expect.poll(async () => page.getByTestId('intelligence-row').count(), { timeout: 5_000 }).toBeGreaterThanOrEqual(3)

  // Callouts tab.
  await page.getByRole('tab', { name: /callouts/i }).click()
  await expect
    .poll(async () => page.locator('[data-testid="intelligence-row"][data-kind="callout"]').count(), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(2)

  // Bits tab.
  await page.getByRole('tab', { name: /bits/i }).click()
  await expect
    .poll(async () => page.locator('[data-testid="intelligence-row"][data-kind="bitsContext"]').count(), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(1)
})

test('multi-stream: each column has its own RaidRiskChip', async ({ page, eventSub }) => {
  test.setTimeout(60_000)
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
  await proxy.wsOpened

  await expect(page.getByTestId('raid-risk-chip')).toHaveCount(4, { timeout: 10_000 })
})
