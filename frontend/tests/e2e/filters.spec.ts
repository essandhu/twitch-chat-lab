import { test, expect, openDemo } from './fixtures'

// Deterministic fixture: 20 messages covering filter intersections.
// 4 first-timers with unique user_ids (u_ft_1..4). One of them (u_ft_sub) is also a subscriber.
// 3 messages from an already-seen subscriber (sub_a) — only the FIRST one counts as first-timer (handled below).
// 5 messages contain the keyword "lol".
// Rest are mundane.
const SUB_BADGE = [{ set_id: 'subscriber', id: '12', info: '12' }]

const MESSAGES: Array<{ user: string; userId: string; text: string; sub: boolean }> = [
  // Intro: sub_a's first message makes them a first-timer too. Not counted in the "4 FT" list though.
  { user: 'sub_a', userId: 'uid_sub_a', text: 'hey all', sub: true },
  { user: 'mundane_1', userId: 'uid_m1', text: 'just watching', sub: false },
  { user: 'sub_a', userId: 'uid_sub_a', text: 'pog moment', sub: true },
  { user: 'u_ft_1', userId: 'uid_ft_1', text: 'first hello', sub: false },
  { user: 'mundane_2', userId: 'uid_m2', text: 'nice play', sub: false },
  { user: 'u_ft_sub', userId: 'uid_ft_sub', text: 'joining with sub lol', sub: true },
  { user: 'sub_a', userId: 'uid_sub_a', text: 'this is cool lol', sub: true },
  { user: 'u_ft_2', userId: 'uid_ft_2', text: 'hi chat', sub: false },
  { user: 'mundane_3', userId: 'uid_m3', text: 'boop', sub: false },
  { user: 'u_ft_3', userId: 'uid_ft_3', text: 'hello world', sub: false },
  { user: 'sub_b', userId: 'uid_sub_b', text: 'lol that play', sub: true },
  { user: 'u_ft_4', userId: 'uid_ft_4', text: 'greetings', sub: false },
  { user: 'mundane_4', userId: 'uid_m4', text: 'yeah', sub: false },
  { user: 'mundane_1', userId: 'uid_m1', text: 'lol', sub: false },
  { user: 'mundane_5', userId: 'uid_m5', text: 'woah', sub: false },
  { user: 'sub_b', userId: 'uid_sub_b', text: 'epic', sub: true },
  { user: 'mundane_6', userId: 'uid_m6', text: 'lol indeed', sub: false },
  { user: 'mundane_7', userId: 'uid_m7', text: 'GG', sub: false },
  { user: 'mundane_8', userId: 'uid_m8', text: 'xdd', sub: false },
  { user: 'mundane_9', userId: 'uid_m9', text: 'byee', sub: false },
]

const pushAll = async (
  handle: Awaited<ReturnType<Awaited<typeof openDemo>>>,
) => {
  for (const m of MESSAGES) {
    handle.pushChatMessage({
      username: m.user,
      userId: m.userId,
      text: m.text,
      badges: m.sub ? SUB_BADGE : [],
    })
  }
}

const rowCount = async (page: import('@playwright/test').Page) =>
  page.getByTestId('chat-row').count()

test('filters compose with AND logic: first-timers × subscribers × keyword', async ({ page, eventSub }) => {
  const handle = await openDemo(page, eventSub)
  await pushAll(handle)

  // Wait for all 20 rows (before filtering).
  await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(20)

  // Toggle firstTimeOnly — expect 5 first-timers (u_ft_1..4 + sub_a + u_ft_sub + sub_b + 4 mundane + first-ever of sub_a)...
  // Our seed: uniqueness by user_id. Unique first-seen users are: sub_a, mundane_1, u_ft_1, mundane_2, u_ft_sub,
  //   u_ft_2, mundane_3, u_ft_3, sub_b, u_ft_4, mundane_4, mundane_5, mundane_6, mundane_7, mundane_8, mundane_9.
  // = 16 first-timers (every distinct user_id's first appearance). Assert that instead of an abstract "4".
  await page.getByRole('button', { name: /first-timers/i }).click()
  await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(16)
  await expect(page.getByTestId('filter-count')).toHaveText('1')

  // Add subscribersOnly — only first-timers who also have the subscriber badge.
  // Subscriber first-timers: sub_a (first msg), u_ft_sub (first msg), sub_b (first msg) = 3
  await page.getByRole('button', { name: /subscribers/i }).click()
  await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(3)
  await expect(page.getByTestId('filter-count')).toHaveText('2')

  // Turn off firstTimeOnly, keep subscribersOnly, add keyword "lol".
  // Subscriber messages containing "lol": u_ft_sub ("joining with sub lol"), sub_a msg 3 ("this is cool lol"), sub_b msg 1 ("lol that play") = 3
  await page.getByRole('button', { name: /first-timers/i }).click()
  await page.getByLabel(/keyword filter/i).fill('lol')
  await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(3)
  await expect(page.getByTestId('filter-count')).toHaveText('2')

  // Clear all filters — full 20 messages render again.
  await page.getByRole('button', { name: /subscribers/i }).click()
  await page.getByLabel(/keyword filter/i).fill('')
  await expect.poll(() => rowCount(page), { timeout: 5_000 }).toBe(20)
})
