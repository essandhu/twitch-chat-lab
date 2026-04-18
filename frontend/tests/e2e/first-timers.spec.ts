import { test, expect, openDemo } from './fixtures'

test('first-timer tab shows live count + entries; re-seen users do not increment', async ({
  page,
  eventSub,
}) => {
  const handle = await openDemo(page, eventSub)

  const newcomers = ['alpha', 'bravo', 'charlie', 'delta', 'echo']
  for (const u of newcomers) {
    handle.pushChatMessage({ username: u, userId: `uid_${u}`, text: `hey from ${u}` })
  }

  const tab = page.getByRole('tab', { name: /first-timers/i })
  await expect(tab).toContainText('5')

  await tab.click()

  // Entries are <article>; usernames are links to twitch.tv/{login}.
  const entries = page.locator('article')
  await expect.poll(async () => await entries.count(), { timeout: 5_000 }).toBe(5)

  for (const u of newcomers) {
    await expect(page.getByRole('link', { name: new RegExp(`View ${u}'s Twitch page`, 'i') })).toHaveAttribute(
      'href',
      `https://twitch.tv/${u}`,
    )
  }

  // Re-seen users: push 2 messages from already-known users — no badge increment.
  handle.pushChatMessage({ username: 'alpha', userId: 'uid_alpha', text: 'hey again' })
  handle.pushChatMessage({ username: 'bravo', userId: 'uid_bravo', text: 'still here' })
  await page.waitForTimeout(300)
  await expect(tab).toContainText('5')
  await expect(entries).toHaveCount(5)

  // New newcomer: count becomes 6.
  handle.pushChatMessage({ username: 'foxtrot', userId: 'uid_foxtrot', text: 'fresh face' })
  await expect(tab).toContainText('6')
  await expect.poll(async () => await entries.count(), { timeout: 5_000 }).toBe(6)

  // Switch back to chat tab — ChatList is visible again.
  await page.getByRole('tab', { name: /^chat/i }).click()
  await expect(page.getByTestId('chat-list')).toBeVisible()
})
