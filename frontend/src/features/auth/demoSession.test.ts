import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelixStream, HelixUser } from '../../types/twitch'

const helixMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getStream: vi.fn(),
  getStreamsByCategory: vi.fn(),
  getGlobalBadges: vi.fn(),
  getChannelBadges: vi.fn(),
}))

const eventSubMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
}))

const authMock = vi.hoisted(() => ({
  useDemoToken: vi.fn(),
}))

vi.mock('./authServices', () => ({
  twitchAuthService: authMock,
  twitchHelixClient: helixMock,
  eventSubManager: eventSubMock,
}))

import { useChatStore } from '../../store/chatStore'
import { startDemoSession } from './demoSession'

const helixUser = (login: string, id: string): HelixUser => ({
  id,
  login,
  display_name: login.charAt(0).toUpperCase() + login.slice(1),
  profile_image_url: '',
})

const helixStream = (userId: string, userLogin: string): HelixStream => ({
  id: 's1',
  user_id: userId,
  user_login: userLogin,
  user_name: userLogin,
  title: 'Demo live',
  game_id: 'g509658',
  game_name: 'Just Chatting',
  viewer_count: 4200,
  started_at: new Date('2025-01-01T00:00:00Z').toISOString(),
  thumbnail_url: '',
})

describe('startDemoSession', () => {
  beforeEach(() => {
    helixMock.getUser.mockReset()
    helixMock.getStream.mockReset()
    helixMock.getStreamsByCategory.mockReset()
    helixMock.getGlobalBadges.mockReset()
    helixMock.getChannelBadges.mockReset()
    eventSubMock.connect.mockReset().mockResolvedValue(undefined)
    eventSubMock.disconnect.mockReset()
    authMock.useDemoToken.mockReset()
    useChatStore.setState({
      session: null,
      messages: [],
      firstTimers: [],
      seenUserIds: new Set(),
      badgeDefinitions: {},
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  it('seeds the demo token with the config user id before doing anything else', async () => {
    helixMock.getUser.mockResolvedValue(helixUser('demouser', 'b-demo'))
    helixMock.getStream.mockResolvedValue(helixStream('b-demo', 'demouser'))
    helixMock.getGlobalBadges.mockResolvedValue({})
    helixMock.getChannelBadges.mockResolvedValue({})

    await startDemoSession({
      channel: 'demouser',
      userId: 'u-99',
      token: 'demo-token',
      mode: 'fixture',
    })

    expect(authMock.useDemoToken).toHaveBeenCalledWith('demo-token', 'u-99')
  })

  it('writes a connected session with the resolved broadcaster and stream', async () => {
    helixMock.getUser.mockResolvedValue(helixUser('demouser', 'b-demo'))
    helixMock.getStream.mockResolvedValue(helixStream('b-demo', 'demouser'))
    helixMock.getGlobalBadges.mockResolvedValue({ subscriber: { '0': 'g0.png' } })
    helixMock.getChannelBadges.mockResolvedValue({ subscriber: { '12': 'c12.png' } })

    await startDemoSession({
      channel: 'demouser',
      userId: 'u-99',
      token: 'demo-token',
      mode: 'fixture',
    })

    const session = useChatStore.getState().session
    expect(session?.broadcasterId).toBe('b-demo')
    expect(session?.broadcasterLogin).toBe('demouser')
    expect(session?.gameName).toBe('Just Chatting')
    expect(session?.viewerCount).toBe(4200)
    expect(session?.isConnected).toBe(true)

    const badges = useChatStore.getState().badgeDefinitions
    expect(badges.subscriber?.['12']).toBe('c12.png')
    expect(badges.subscriber?.['0']).toBe('g0.png')
  })

  it('connects EventSub with the demo user id and token (no authed-user lookup)', async () => {
    helixMock.getUser.mockResolvedValue(helixUser('demouser', 'b-demo'))
    helixMock.getStream.mockResolvedValue(null)
    helixMock.getGlobalBadges.mockResolvedValue({})
    helixMock.getChannelBadges.mockResolvedValue({})

    await startDemoSession({
      channel: 'demouser',
      userId: 'u-99',
      token: 'demo-token',
      mode: 'cached',
    })

    expect(eventSubMock.connect).toHaveBeenCalledWith({
      broadcasterId: 'b-demo',
      userId: 'u-99',
      token: 'demo-token',
    })
    // Only the channel lookup happens — no no-arg getUser() for an authed user.
    expect(helixMock.getUser).toHaveBeenCalledTimes(1)
    expect(helixMock.getUser).toHaveBeenCalledWith('demouser')
  })

  it('throws when the demo channel cannot be resolved', async () => {
    helixMock.getUser.mockResolvedValue(null)

    await expect(
      startDemoSession({
        channel: 'missing',
        userId: 'u-99',
        token: 'demo-token',
        mode: 'cached',
      }),
    ).rejects.toThrow(/missing/)
    expect(eventSubMock.connect).not.toHaveBeenCalled()
  })

  it('picks a live channel from Helix when config.channel is omitted (cached mode)', async () => {
    helixMock.getStreamsByCategory.mockResolvedValue([
      helixStream('b-live', 'livechannel'),
    ])
    helixMock.getUser.mockResolvedValue(helixUser('livechannel', 'b-live'))
    helixMock.getStream.mockResolvedValue(helixStream('b-live', 'livechannel'))
    helixMock.getGlobalBadges.mockResolvedValue({})
    helixMock.getChannelBadges.mockResolvedValue({})

    await startDemoSession({ userId: 'u-99', token: 'demo-token', mode: 'cached' })

    // Just Chatting category id, 20 candidates.
    expect(helixMock.getStreamsByCategory).toHaveBeenCalledWith('509658', 20)
    expect(helixMock.getUser).toHaveBeenCalledWith('livechannel')
    expect(useChatStore.getState().session?.broadcasterLogin).toBe('livechannel')
  })

  it('skips streams with empty user_login and picks the first valid one', async () => {
    helixMock.getStreamsByCategory.mockResolvedValue([
      { ...helixStream('b-empty', ''), user_login: '' },
      helixStream('b-second', 'secondpick'),
    ])
    helixMock.getUser.mockResolvedValue(helixUser('secondpick', 'b-second'))
    helixMock.getStream.mockResolvedValue(helixStream('b-second', 'secondpick'))
    helixMock.getGlobalBadges.mockResolvedValue({})
    helixMock.getChannelBadges.mockResolvedValue({})

    await startDemoSession({ userId: 'u-99', token: 'demo-token', mode: 'cached' })

    expect(helixMock.getUser).toHaveBeenCalledWith('secondpick')
  })

  it('throws when Helix returns zero live streams and does NOT connect', async () => {
    helixMock.getStreamsByCategory.mockResolvedValue([])

    await expect(
      startDemoSession({ userId: 'u-99', token: 'demo-token', mode: 'cached' }),
    ).rejects.toThrow(/no live demo channel/)
    expect(helixMock.getUser).not.toHaveBeenCalled()
    expect(eventSubMock.connect).not.toHaveBeenCalled()
  })

  it('propagates Helix errors from the live-stream query (no static fallback)', async () => {
    helixMock.getStreamsByCategory.mockRejectedValue(new Error('helix 500'))

    await expect(
      startDemoSession({ userId: 'u-99', token: 'demo-token', mode: 'cached' }),
    ).rejects.toThrow(/helix 500/)
    expect(eventSubMock.connect).not.toHaveBeenCalled()
  })
})
