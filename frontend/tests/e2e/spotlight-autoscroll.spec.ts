import { test, expect, openDemo } from './fixtures'
import { installProxyRoutes } from './mocks/proxy'

test('spotlight feed: auto-scrolls on new messages and shows jump-to-latest when scrolled up', async ({
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

  // Push enough messages across streams to overflow the spotlight feed viewport.
  const push = (count: number, start: number) => {
    for (let i = 0; i < count; i++) {
      const n = start + i
      const target = n % 3 === 0 ? 'demouser' : n % 3 === 1 ? 'alt_one' : 'alt_two'
      proxyHandle.pushChat(target, `spot msg ${n}`, `user${n}`)
    }
  }
  push(60, 0)

  const feed = page.getByTestId('spotlight-feed')
  await expect(feed).toBeVisible()

  // Wait until the last-pushed message is visible — proves auto-scroll is active.
  await expect(feed.getByText('spot msg 59').first()).toBeVisible({ timeout: 10_000 })

  // Jump-to-latest should NOT be visible while auto-scroll is on.
  const jump = page.getByRole('button', { name: /scroll to latest message/i })
  await expect(jump).toBeHidden()

  // Scroll up to disable auto-scroll (distance-from-bottom > 150 px).
  await feed.evaluate((el) => {
    el.scrollTop = 0
  })

  await expect(jump).toBeVisible({ timeout: 5_000 })

  // Push more — they should arrive but auto-scroll stays off since user scrolled up.
  push(20, 60)
  // Latest message exists in DOM but feed should NOT have auto-scrolled to it.
  // (We can't cleanly assert "is not at bottom" without flakiness, so just confirm
  // the jump button is still visible — it would hide if auto-scroll re-engaged.)
  await expect(jump).toBeVisible()

  // Click jump-to-latest — should restore auto-scroll + hide button.
  await jump.click()
  await expect(jump).toBeHidden({ timeout: 5_000 })
  await expect(feed.getByText('spot msg 79').first()).toBeVisible()
})
