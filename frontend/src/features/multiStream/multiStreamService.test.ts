import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamSession } from '../../types/twitch'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import type { ProxyClient } from './ProxyClient'
import { ProxyError } from './ProxyClient'
import type { StreamPick } from './StreamSelector'

vi.mock('../auth/authServices', () => ({
  twitchAuthService: {
    getToken: vi.fn(() => 'stub-token'),
  },
  twitchHelixClient: {
    // Return null so hydrateProfileImages is a no-op in tests.
    getUser: vi.fn(async () => null),
  },
  eventSubManager: {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(() => undefined),
  },
}))

// Import AFTER the mock so the service picks up our stubbed auth singletons.
import {
  __resetMultiStreamServiceForTests,
  diffChannels,
  startCompare,
  stopCompare,
  updateCompare,
} from './multiStreamService'

type FakeProxyClient = {
  createSession: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  patchSession: ReturnType<typeof vi.fn>
  getSessionId: ReturnType<typeof vi.fn>
  isConnected: ReturnType<typeof vi.fn>
}

const makeFakeClient = (overrides: Partial<FakeProxyClient> = {}): FakeProxyClient => ({
  createSession: vi.fn(async (args: { channels: Array<{ login: string }> }) => ({
    sessionId: 'sess-' + args.channels.map((c) => c.login).join('-'),
  })),
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  patchSession: vi.fn(async () => ({ sessionId: 'sess-patch', channels: [] })),
  getSessionId: vi.fn(() => 'sess-current'),
  isConnected: vi.fn(() => true),
  ...overrides,
})

const asClient = (f: FakeProxyClient): ProxyClient => f as unknown as ProxyClient

const makeSession = (login: string): StreamSession => ({
  broadcasterId: 'b_' + login,
  broadcasterLogin: login,
  broadcasterDisplayName: login.charAt(0).toUpperCase() + login.slice(1),
  streamTitle: '',
  gameName: '',
  gameId: '',
  viewerCount: 0,
  startedAt: new Date(0),
  isConnected: true,
  profileImageUrl: '',
})

const pick = (login: string): StreamPick => ({
  login,
  displayName: login.charAt(0).toUpperCase() + login.slice(1),
  broadcasterId: 'b_' + login,
})

describe('diffChannels', () => {
  it('returns empty add/remove when lists match by login', () => {
    const prev = [
      { login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' },
      { login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' },
    ]
    const next = [
      { login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' },
      { login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' },
    ]
    expect(diffChannels(prev, next)).toEqual({ add: [], remove: [] })
  })

  it('classifies net-new entries as adds', () => {
    const prev = [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }]
    const next = [
      { login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' },
      { login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' },
    ]
    const diff = diffChannels(prev, next)
    expect(diff.remove).toEqual([])
    expect(diff.add.map((c) => c.login)).toEqual(['bob'])
  })

  it('classifies missing entries as removes (logins only)', () => {
    const prev = [
      { login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' },
      { login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' },
    ]
    const next = [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }]
    expect(diffChannels(prev, next)).toEqual({ add: [], remove: ['bob'] })
  })

  it('handles a full-replace swap', () => {
    const prev = [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }]
    const next = [{ login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' }]
    const diff = diffChannels(prev, next)
    expect(diff.add.map((c) => c.login)).toEqual(['bob'])
    expect(diff.remove).toEqual(['alice'])
  })
})

describe('updateCompare', () => {
  beforeEach(() => {
    __resetMultiStreamServiceForTests()
    useMultiStreamStore.getState().reset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(async () => {
    // Don't leave global isActive flipped on — leaks into MultiStreamLayout tests.
    try {
      await stopCompare()
    } catch {
      /* ignore */
    }
    __resetMultiStreamServiceForTests()
    useMultiStreamStore.getState().reset()
    vi.restoreAllMocks()
  })

  it('takes the PATCH fast path when a previous session exists and the diff is non-empty', async () => {
    const client = makeFakeClient()
    client.patchSession = vi.fn(async () => ({
      sessionId: 'sess-current',
      channels: ['alice', 'carol'],
    }))

    // Bootstrap an active session so updateCompare has a previous client + channels.
    await startCompare({
      session: makeSession('alice'),
      authedUserId: 'u1',
      picks: [pick('bob')],
      clientFactory: () => asClient(client),
    })

    // Now swap bob → carol. Expected: patchSession called, no new client created.
    await updateCompare({
      session: makeSession('alice'),
      authedUserId: 'u1',
      picks: [pick('carol')],
      clientFactory: () => {
        throw new Error('clientFactory should not be invoked on PATCH fast path')
      },
    })

    expect(client.patchSession).toHaveBeenCalledTimes(1)
    const patchArgs = client.patchSession.mock.calls[0]![0] as {
      sessionId: string
      add: Array<{ login: string }>
      remove: string[]
    }
    expect(patchArgs.sessionId).toBe('sess-current')
    expect(patchArgs.add.map((c) => c.login)).toEqual(['carol'])
    expect(patchArgs.remove).toEqual(['bob'])
    // Full-recreate path must NOT have fired.
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.createSession).toHaveBeenCalledTimes(1) // only the initial startCompare
  })

  it('treats an empty diff as a no-op (no PATCH, no recreate)', async () => {
    const client = makeFakeClient()
    await startCompare({
      session: makeSession('alice'),
      authedUserId: 'u1',
      picks: [pick('bob')],
      clientFactory: () => asClient(client),
    })

    await updateCompare({
      session: makeSession('alice'),
      authedUserId: 'u1',
      picks: [pick('bob')],
      clientFactory: () => {
        throw new Error('factory should not fire for a no-op update')
      },
    })

    expect(client.patchSession).not.toHaveBeenCalled()
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(client.createSession).toHaveBeenCalledTimes(1)
  })

  it('falls back to full recreate when PATCH fails', async () => {
    const firstClient = makeFakeClient()
    firstClient.patchSession = vi.fn(async () => {
      throw new ProxyError(502, '{"error":"upstream_failed"}')
    })
    const secondClient = makeFakeClient()

    await startCompare({
      session: makeSession('alice'),
      authedUserId: 'u1',
      picks: [pick('bob')],
      clientFactory: () => asClient(firstClient),
    })

    await updateCompare({
      session: makeSession('alice'),
      authedUserId: 'u1',
      picks: [pick('carol')],
      clientFactory: () => asClient(secondClient),
    })

    // PATCH was tried once, then failed, then recreate path ran.
    expect(firstClient.patchSession).toHaveBeenCalledTimes(1)
    expect(firstClient.disconnect).toHaveBeenCalledTimes(1)
    expect(secondClient.createSession).toHaveBeenCalledTimes(1)
    expect(secondClient.connect).toHaveBeenCalledTimes(1)
  })

  it('still works (full recreate) when there is no previous session state — defensive path', async () => {
    // Simulate a race where isActive is true but activeChannels is empty
    // (e.g., module was hot-reloaded mid-session). updateCompare should
    // fall through to the recreate branch without crashing.
    useMultiStreamStore.getState().setActive(true)

    const client = makeFakeClient()
    await updateCompare({
      session: makeSession('alice'),
      authedUserId: 'u1',
      picks: [pick('bob')],
      clientFactory: () => asClient(client),
    })

    expect(client.patchSession).not.toHaveBeenCalled()
    expect(client.createSession).toHaveBeenCalledTimes(1)
    expect(client.connect).toHaveBeenCalledTimes(1)
  })
})
