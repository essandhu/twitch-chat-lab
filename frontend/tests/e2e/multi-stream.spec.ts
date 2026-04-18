import { test, expect, openDemo } from './fixtures'
import { installProxyRoutes } from './mocks/proxy'

test('multi-stream: add 2 channels, see 3 columns, upstream_lost degrades one, exit deletes session', async ({
  page,
  eventSub,
}) => {
  test.setTimeout(60_000)
  // Proxy interception set up BEFORE navigation so no request escapes.
  const proxy = await installProxyRoutes(page)

  await openDemo(page, eventSub)

  // Wait for StreamHeader to fully render (proves demo-session is live) before Compare.
  await expect(page.getByRole('button', { name: /compare streams/i })).toBeEnabled({
    timeout: 15_000,
  })

  // Open StreamSelector via the Compare streams button in StreamHeader.
  await page.getByRole('button', { name: /compare streams/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })

  // Five alternate streams (from helix fixture) minus the current demouser = 5 options.
  const selectBoxes = page.getByRole('checkbox', { name: /select /i })
  await expect(selectBoxes).toHaveCount(5, { timeout: 10_000 })

  // Pick 2 alternates.
  await selectBoxes.nth(0).click()
  await selectBoxes.nth(1).click()

  // Confirm.
  await page.getByRole('button', { name: /^compare$/i }).click()

  // Proxy WS opens; fetch the handle.
  const proxyHandle = await proxy.wsOpened

  // MultiStreamLayout replaces the chat tab — assert the Exit button is visible.
  await expect(page.getByRole('button', { name: /exit multi-stream mode/i })).toBeVisible()

  // Three columns: demouser + alt_one + alt_two (per DEFAULT_HELIX.alternateStreams[0..1]).
  // Column headers display the broadcaster display name.
  await expect(page.getByText(/demouser/i).first()).toBeVisible()
  await expect(page.getByText(/altone/i)).toBeVisible()
  await expect(page.getByText(/alttwo/i)).toBeVisible()

  // Fan enveloped chat into each column.
  proxyHandle.pushChat('demouser', 'hello from demouser', 'userA')
  proxyHandle.pushChat('alt_one', 'hello from alt_one', 'userB')
  proxyHandle.pushChat('alt_two', 'hello from alt_two', 'userC')

  // Each column should receive only its own frames.
  await expect(page.getByText('hello from demouser')).toBeVisible()
  await expect(page.getByText('hello from alt_one')).toBeVisible()
  await expect(page.getByText('hello from alt_two')).toBeVisible()

  // Trigger upstream_lost on alt_one — its column surfaces the degraded banner.
  proxyHandle.pushUpstreamLost('alt_one')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText(/connection lost/i)).toBeVisible()

  // Other columns keep receiving.
  proxyHandle.pushChat('alt_two', 'still alive', 'userD')
  await expect(page.getByText('still alive')).toBeVisible()

  // Exit compare — MultiStreamLayout unmounts, single-stream layout returns,
  // DELETE /session is issued.
  await page.getByRole('button', { name: /exit multi-stream mode/i }).click()
  await expect(page.getByRole('button', { name: /exit multi-stream mode/i })).toHaveCount(0)

  await expect.poll(() => proxy.deleteCount(), { timeout: 5_000 }).toBeGreaterThanOrEqual(1)
})
