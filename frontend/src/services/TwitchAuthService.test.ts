import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TwitchAuthService } from './TwitchAuthService'

// Fake env for tests
vi.stubEnv('VITE_TWITCH_CLIENT_ID', 'test-client-id')
vi.stubEnv('VITE_TWITCH_REDIRECT_URI', 'http://localhost:5173/auth/callback')

const originalLocation = window.location

const replaceLocation = () => {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...originalLocation, assign, href: '', hash: '' } as unknown as Location,
  })
  return assign
}

const restoreLocation = () => {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: originalLocation,
  })
}

describe('TwitchAuthService', () => {
  let service: TwitchAuthService

  beforeEach(() => {
    sessionStorage.clear()
    service = new TwitchAuthService({
      clientId: 'test-client-id',
      redirectUri: 'http://localhost:5173/auth/callback',
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    restoreLocation()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('authorize() stores state in sessionStorage and redirects to the Twitch authorize URL', () => {
    const assign = replaceLocation()
    service.authorize()

    const state = sessionStorage.getItem('twitch_oauth_state')
    expect(state).toBeTruthy()
    expect(state?.length ?? 0).toBeGreaterThanOrEqual(16)

    expect(assign).toHaveBeenCalledOnce()
    const url = new URL(assign.mock.calls[0]?.[0] as string)
    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/auth/callback')
    expect(url.searchParams.get('response_type')).toBe('token')
    expect(url.searchParams.get('state')).toBe(state)
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('user:read:chat')
    expect(scope).toContain('channel:read:subscriptions')
    expect(scope).toContain('channel:read:hype_train')
  })

  it('handleCallback returns success and exposes the token when state matches', () => {
    sessionStorage.setItem('twitch_oauth_state', 'xyz')
    const fragment = '#access_token=abc&token_type=bearer&expires_in=3600&scope=user:read:chat&state=xyz'

    const result = service.handleCallback(fragment)

    expect(result).toEqual({ success: true })
    expect(service.getToken()).toBe('abc')
    expect(sessionStorage.getItem('twitch_oauth_state')).toBeNull()
  })

  it('handleCallback rejects and clears nothing when state mismatches', () => {
    sessionStorage.setItem('twitch_oauth_state', 'expected')
    const fragment = '#access_token=abc&state=mismatched&expires_in=3600'

    const result = service.handleCallback(fragment)

    expect(result).toEqual({ success: false, error: 'state_mismatch' })
    expect(service.getToken()).toBeNull()
  })

  it('handleCallback rejects when no access_token is present', () => {
    sessionStorage.setItem('twitch_oauth_state', 'xyz')
    const result = service.handleCallback('#state=xyz')
    expect(result.success).toBe(false)
    expect(service.getToken()).toBeNull()
  })

  it('getToken returns null after the expiry window elapses', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    service.setToken('abc', 10)
    expect(service.getToken()).toBe('abc')
    vi.advanceTimersByTime(11_000)
    expect(service.getToken()).toBeNull()
  })

  it('validate() returns true on 200 and false on 401; 401 fires the re-auth handler', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))

    const reAuth = vi.fn()
    service.onReAuthRequired(reAuth)
    service.setToken('abc', 3600)

    await expect(service.validate()).resolves.toBe(true)
    expect(reAuth).not.toHaveBeenCalled()

    await expect(service.validate()).resolves.toBe(false)
    expect(reAuth).toHaveBeenCalledOnce()
    expect(service.getToken()).toBeNull()

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [, , requestInit] = [
      fetchSpy.mock.calls[0]?.[0],
      fetchSpy.mock.calls[0]?.[1] as RequestInit,
      fetchSpy.mock.calls[0]?.[1] as RequestInit,
    ]
    const headers = new Headers(requestInit.headers)
    expect(headers.get('Authorization')).toBe('OAuth abc')
  })

  it('validate() returns false with no token and does not call fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(service.validate()).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('clearToken resets token and expiry', () => {
    service.setToken('abc', 3600)
    expect(service.getToken()).toBe('abc')
    service.clearToken()
    expect(service.getToken()).toBeNull()
  })
})
