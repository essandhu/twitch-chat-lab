import { test as base, type Page, type WebSocketRoute } from '@playwright/test'
import { DEFAULT_HELIX, installHelixRoutes, type HelixFixtureOptions } from './mocks/helix'
import { openFakeEventSub, type FakeEventSubHandle } from './mocks/eventsub'

interface MockFixtures {
  /** Mocked Helix options in use for this test. */
  helixOptions: HelixFixtureOptions
  /** Resolves once the client's EventSub WebSocket has opened. */
  eventSub: Promise<FakeEventSubHandle>
}

/**
 * Wraps Playwright's `test` with:
 *  - `page.route('**\/api.twitch.tv/helix/**', ...)` for canned Helix REST
 *  - `page.routeWebSocket('wss://eventsub.wss.twitch.tv/**', ...)` for canned EventSub frames
 *
 * Tests receive `eventSub` (a promise resolving to push helpers) and navigate to `/?demo=playwright`.
 */
export const test = base.extend<MockFixtures>({
  helixOptions: async ({}, use) => {
    await use(DEFAULT_HELIX)
  },
  eventSub: async ({ page, helixOptions }, use) => {
    await page.route('**/api.twitch.tv/helix/**', (route) =>
      installHelixRoutes(route, helixOptions),
    )
    await page.route('**/id.twitch.tv/oauth2/validate', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )

    let resolve: (h: FakeEventSubHandle) => void
    const handle = new Promise<FakeEventSubHandle>((r) => {
      resolve = r
    })

    await page.routeWebSocket('wss://eventsub.wss.twitch.tv/**', (ws: WebSocketRoute) => {
      resolve(openFakeEventSub(ws))
    })

    await use(handle)
  },
})

export const expect = test.expect

/** Convenience: opens the demo URL and returns the EventSub push helpers once connected. */
export const openDemo = async (page: Page, eventSub: Promise<FakeEventSubHandle>) => {
  await page.goto('/?demo=playwright')
  return eventSub
}
