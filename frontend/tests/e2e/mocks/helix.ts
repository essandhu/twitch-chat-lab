import type { Route } from '@playwright/test'

export interface HelixFixtureOptions {
  channel: string
  broadcasterId: string
  gameId: string
  gameName: string
  viewerCount: number
  alternateStreams?: Array<{ login: string; display: string; viewers: number }>
}

export const DEFAULT_HELIX: HelixFixtureOptions = {
  channel: 'demouser',
  broadcasterId: '99999999',
  gameId: '509658',
  gameName: 'Just Chatting',
  viewerCount: 4200,
  alternateStreams: [
    { login: 'alt_one', display: 'AltOne', viewers: 1200 },
    { login: 'alt_two', display: 'AltTwo', viewers: 2100 },
    { login: 'alt_three', display: 'AltThree', viewers: 3400 },
    { login: 'alt_four', display: 'AltFour', viewers: 980 },
    { login: 'alt_five', display: 'AltFive', viewers: 670 },
  ],
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

export const installHelixRoutes = async (
  route: Route,
  opts: HelixFixtureOptions = DEFAULT_HELIX,
): Promise<void> => {
  const url = new URL(route.request().url())
  const path = url.pathname

  if (path.endsWith('/helix/users')) {
    const login = url.searchParams.get('login') ?? opts.channel
    await json(route, 200, {
      data: [
        {
          id: opts.broadcasterId,
          login,
          display_name: login.charAt(0).toUpperCase() + login.slice(1),
          profile_image_url: '',
        },
      ],
    })
    return
  }

  if (path.endsWith('/helix/streams')) {
    const gameId = url.searchParams.get('game_id')
    if (gameId) {
      const streams = (opts.alternateStreams ?? []).map((s) => ({
        id: `stream_${s.login}`,
        user_id: `uid_${s.login}`,
        user_login: s.login,
        user_name: s.display,
        title: `${s.display}'s stream`,
        game_id: opts.gameId,
        game_name: opts.gameName,
        viewer_count: s.viewers,
        started_at: new Date().toISOString(),
        thumbnail_url: '',
      }))
      await json(route, 200, { data: streams })
      return
    }
    const login = url.searchParams.get('user_login') ?? opts.channel
    await json(route, 200, {
      data: [
        {
          id: 'stream_1',
          user_id: opts.broadcasterId,
          user_login: login,
          user_name: login.charAt(0).toUpperCase() + login.slice(1),
          title: `${login} live`,
          game_id: opts.gameId,
          game_name: opts.gameName,
          viewer_count: opts.viewerCount,
          started_at: new Date().toISOString(),
          thumbnail_url: '',
        },
      ],
    })
    return
  }

  if (path.endsWith('/helix/chat/badges/global')) {
    await json(route, 200, {
      data: [
        {
          set_id: 'subscriber',
          versions: [{ id: '0', image_url_1x: 'https://cdn.example/badge-sub-0.png' }],
        },
      ],
    })
    return
  }

  if (path.endsWith('/helix/chat/badges')) {
    await json(route, 200, {
      data: [
        {
          set_id: 'subscriber',
          versions: [{ id: '12', image_url_1x: 'https://cdn.example/badge-sub-12.png' }],
        },
      ],
    })
    return
  }

  if (path.endsWith('/helix/chat/settings')) {
    await json(route, 200, { data: [{ slow_mode: false, follower_mode: false }] })
    return
  }

  if (path.endsWith('/helix/eventsub/subscriptions')) {
    // POST — accept any subscription body.
    await json(route, 202, {
      data: [{ id: 'sub_1', status: 'enabled' }],
      total: 1,
      total_cost: 0,
      max_total_cost: 10_000,
    })
    return
  }

  // Fallback: empty OK.
  await json(route, 200, { data: [] })
}
