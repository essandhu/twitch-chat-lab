import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../store/chatStore'
import type { HelixStream, HelixUser } from '../../types/twitch'

vi.stubEnv('VITE_TWITCH_CLIENT_ID', 'test-client-id')
vi.stubEnv('VITE_TWITCH_REDIRECT_URI', 'http://localhost:5173/auth/callback')

const fakeUser = (login: string, id: string): HelixUser => ({
  id,
  login,
  display_name: login.charAt(0).toUpperCase() + login.slice(1),
  profile_image_url: '',
  created_at: '2020-01-01T00:00:00Z',
})

const fakeStream = (userId: string, userLogin: string): HelixStream => ({
  id: 's1',
  user_id: userId,
  user_login: userLogin,
  user_name: userLogin,
  title: 'A stream',
  game_id: 'g1',
  game_name: 'A game',
  viewer_count: 100,
  started_at: new Date('2025-01-01T00:00:00Z').toISOString(),
  thumbnail_url: '',
})

// Hoisted module-level mocks — these replace imports inside AuthCallback.
const helixMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getStream: vi.fn(),
  getGlobalBadges: vi.fn(),
  getChannelBadges: vi.fn(),
}))

const eventSubMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

const authMock = vi.hoisted(() => ({
  handleCallback: vi.fn(),
  getToken: vi.fn(),
  startValidationPolling: vi.fn(),
  onReAuthRequired: vi.fn(),
}))

vi.mock('./authServices', () => ({
  twitchAuthService: authMock,
  twitchHelixClient: helixMock,
  eventSubManager: eventSubMock,
}))

// Lazy import so mocks apply
const importComponent = async () => {
  const mod = await import('./AuthCallback')
  return mod.AuthCallback
}

const setHash = (hash: string) => {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash } as unknown as Location,
  })
}

describe('AuthCallback', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useChatStore.setState({
      session: null,
      messages: [],
      firstTimers: [],
      seenUserIds: new Set(),
      badgeDefinitions: {},
    })
    helixMock.getUser.mockReset()
    helixMock.getStream.mockReset()
    helixMock.getGlobalBadges.mockReset()
    helixMock.getChannelBadges.mockReset()
    eventSubMock.connect.mockReset().mockResolvedValue(undefined)
    eventSubMock.disconnect.mockReset()
    authMock.handleCallback.mockReset()
    authMock.getToken.mockReset()
    authMock.startValidationPolling.mockReset()
    authMock.onReAuthRequired.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('on valid fragment: sets session, connects EventSub, starts validation polling', async () => {
    setHash('#access_token=tok&token_type=bearer&expires_in=3600&scope=user:read:chat&state=ok')
    sessionStorage.setItem('twitch_pending_channel', 'streamer')
    authMock.handleCallback.mockReturnValue({ success: true })
    authMock.getToken.mockReturnValue('tok')
    helixMock.getUser.mockImplementation(async (login?: string) => {
      if (!login) return fakeUser('viewer', 'viewer-id')
      return fakeUser('streamer', 'broadcaster-id')
    })
    helixMock.getStream.mockResolvedValue(fakeStream('broadcaster-id', 'streamer'))
    helixMock.getGlobalBadges.mockResolvedValue({ subscriber: { '0': 'g0.png' } })
    helixMock.getChannelBadges.mockResolvedValue({ subscriber: { '12': 'c12.png' } })

    const AuthCallback = await importComponent()

    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(eventSubMock.connect).toHaveBeenCalledOnce()
    })

    expect(authMock.startValidationPolling).toHaveBeenCalled()
    expect(eventSubMock.connect).toHaveBeenCalledWith({
      broadcasterId: 'broadcaster-id',
      broadcasterLogin: 'streamer',
      userId: 'viewer-id',
      token: 'tok',
    })
    const session = useChatStore.getState().session
    expect(session?.broadcasterLogin).toBe('streamer')
    expect(session?.broadcasterId).toBe('broadcaster-id')
    expect(session?.viewerCount).toBe(100)
    expect(session?.isConnected).toBe(true)
    // Pending channel should be consumed
    expect(sessionStorage.getItem('twitch_pending_channel')).toBeNull()
    // Merged badges: channel override wins
    const badges = useChatStore.getState().badgeDefinitions
    expect(badges.subscriber?.['12']).toBe('c12.png')
    expect(badges.subscriber?.['0']).toBe('g0.png')
  })

  it('on state_mismatch: shows an error and does not call EventSubManager.connect', async () => {
    setHash('#access_token=tok&state=wrong')
    authMock.handleCallback.mockReturnValue({ success: false, error: 'state_mismatch' })

    const AuthCallback = await importComponent()

    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/authentication failed\. please try again\./i)).toBeInTheDocument()
    expect(eventSubMock.connect).not.toHaveBeenCalled()
  })

  it('offline channel (getStream returns null): still connects with zero viewers', async () => {
    setHash('#access_token=tok&state=ok')
    sessionStorage.setItem('twitch_pending_channel', 'offlinechan')
    authMock.handleCallback.mockReturnValue({ success: true })
    authMock.getToken.mockReturnValue('tok')
    helixMock.getUser.mockImplementation(async (login?: string) => {
      if (!login) return fakeUser('viewer', 'viewer-id')
      return fakeUser('offlinechan', 'b-id')
    })
    helixMock.getStream.mockResolvedValue(null)
    helixMock.getGlobalBadges.mockResolvedValue({})
    helixMock.getChannelBadges.mockResolvedValue({})

    const AuthCallback = await importComponent()

    render(
      <MemoryRouter initialEntries={['/auth/callback']}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(eventSubMock.connect).toHaveBeenCalledOnce()
    })
    const session = useChatStore.getState().session
    expect(session?.viewerCount).toBe(0)
    expect(session?.isConnected).toBe(true)
  })
})
