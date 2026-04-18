import { test, expect, openDemo } from './fixtures'

test('demo-mode boot reaches a running session without ConnectForm', async ({ page, eventSub }) => {
  await openDemo(page, eventSub)

  // Demo banner rendered.
  await expect(page.getByRole('status', { name: /demo mode/i })).toBeVisible()

  // ConnectForm input is not in the DOM once the demo handshake completes.
  await expect(page.getByLabel(/twitch channel login/i)).toHaveCount(0)

  // Wait for fixtures to resolve so teardown is clean.
  await eventSub
})
