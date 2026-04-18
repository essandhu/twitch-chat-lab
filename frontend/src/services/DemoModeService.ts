// Read-only demo mode for the public live-demo URL.
//
// Trade-off: `VITE_*` env vars are baked into the bundle at build time, so the
// demo token is publicly visible in the deployed JS. This is acceptable because
// implicit-grant tokens for read-only Twitch scopes are low-risk and rotatable.
// If the token is revoked, the demo breaks until manually rotated — this is
// called out in the README's "Known limitations" section.

export type DemoMode = 'cached' | 'fixture'

export interface DemoConfig {
  // Only set for `fixture` mode (Playwright). For `cached` mode the channel
  // is picked at runtime from a live Helix /streams query so the demo never
  // points at an offline broadcaster.
  channel?: string
  userId: string
  token: string
  mode: DemoMode
}

const PLAYWRIGHT_FIXTURE: DemoConfig = {
  channel: 'demouser',
  userId: '99999999',
  token: 'PLAYWRIGHT_FIXTURE_TOKEN',
  mode: 'fixture',
}

const demoParam = (): string | null => {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('demo')
}

export const isDemoMode = (): boolean => {
  const value = demoParam()
  return value === '1' || value === 'playwright'
}

const readEnv = (key: string): string => {
  const value = import.meta.env[key]
  return typeof value === 'string' ? value : ''
}

export const getDemoConfig = (): DemoConfig | null => {
  const value = demoParam()
  if (value === 'playwright') return PLAYWRIGHT_FIXTURE
  if (value !== '1') return null

  const userId = readEnv('VITE_DEMO_USER_ID')
  const token = readEnv('VITE_DEMO_TOKEN')
  if (!userId || !token) return null
  return { userId, token, mode: 'cached' }
}
