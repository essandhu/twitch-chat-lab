import { test, expect, openDemo } from './fixtures'

test('demo boot renders banner + stream header; ConnectForm is absent', async ({ page, eventSub }) => {
  const handle = await openDemo(page, eventSub)
  await expect.poll(async () => handle.ws.url()).toContain('eventsub.wss.twitch.tv')

  await expect(page.getByRole('status', { name: /demo mode/i })).toBeVisible()
  await expect(page.getByText(/demouser/i).first()).toBeVisible()
  await expect(page.getByText(/just chatting/i).first()).toBeVisible()
  await expect(page.getByTestId('chat-list')).toBeVisible()
  await expect(page.getByLabel(/twitch channel login/i)).toHaveCount(0)
})

test('chat auto-scrolls while pinned to bottom', async ({ page, eventSub }) => {
  const handle = await openDemo(page, eventSub)

  for (let i = 0; i < 50; i++) {
    handle.pushChatMessage({
      username: `user${i}`,
      userId: `user${i}-id`,
      text: `message ${i}`,
    })
    // ~10 msg/sec cadence
    await page.waitForTimeout(100)
  }

  // Bottom-most rendered row should match the last pushed message.
  await expect
    .poll(
      async () => {
        const rows = await page.getByTestId('chat-row').allTextContents()
        return rows.at(-1) ?? ''
      },
      { timeout: 5_000 },
    )
    .toContain('message 49')
})

test('ScrollToBottom appears on scroll-up, hides on click', async ({ page, eventSub }) => {
  const handle = await openDemo(page, eventSub)

  for (let i = 0; i < 50; i++) {
    handle.pushChatMessage({
      username: `u${i}`,
      userId: `u${i}-id`,
      text: `seed ${i}`,
    })
  }
  // Wait for at least some rows to render.
  await expect
    .poll(async () => (await page.getByTestId('chat-row').count()) > 0, { timeout: 5_000 })
    .toBeTruthy()

  // Scroll the chat list upward by 500 px.
  await page
    .getByTestId('chat-list')
    .evaluate((el) => {
      ;(el as HTMLElement).scrollTop = Math.max(0, (el as HTMLElement).scrollTop - 500)
    })

  // Push 5 more so ScrollToBottom persists.
  for (let i = 50; i < 55; i++) {
    handle.pushChatMessage({ username: `u${i}`, userId: `u${i}-id`, text: `later ${i}` })
  }

  const scrollBtn = page.getByRole('button', { name: /scroll to latest message/i })
  await expect(scrollBtn).toBeVisible()

  await scrollBtn.click()
  await expect(scrollBtn).toBeHidden()
})
