import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import type { ChannelChatMessageEvent, ProxyEnvelope } from '../../types/twitch'
import { ProxyClient, ProxyError } from './ProxyClient'

// FakeSocket mirrors the one used in EventSubManager.test.ts so we can drive
// the ProxyClient state machine deterministically without a real WS.
class FakeSocket {
  static OPEN = 1
  static CLOSED = 3

  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null

  send = vi.fn()
  close = vi.fn()

  readonly url: string
  readyState: number = 0

  constructor(url: string) {
    this.url = url
  }

  emitOpen(): void {
    this.readyState = FakeSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  emitMessage(data: unknown): void {
    const ev = { data: JSON.stringify(data) } as MessageEvent
    this.onmessage?.(ev)
  }

  emitError(): void {
    this.onerror?.(new Event('error'))
  }
}

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve()
  }
}

const rawChatEvent = (login: string, userId: string, text: string): ChannelChatMessageEvent => ({
  broadcaster_user_id: `b_${login}`,
  broadcaster_user_login: login,
  broadcaster_user_name: login.toUpperCase(),
  chatter_user_id: userId,
  chatter_user_login: `user_${userId}`,
  chatter_user_name: `User${userId}`,
  message_id: `m_${userId}_${Math.random().toString(36).slice(2, 8)}`,
  message: {
    text,
    fragments: [{ type: 'text', text }],
  },
  color: '#ffffff',
  badges: [],
  message_type: 'text',
})

const chatEnvelope = (login: string, event: ChannelChatMessageEvent): ProxyEnvelope => ({
  stream_login: login,
  event_type: 'channel.chat.message',
  payload: {
    metadata: {
      message_id: `m-${event.message_id}`,
      message_type: 'notification',
      message_timestamp: new Date().toISOString(),
      subscription_type: 'channel.chat.message',
      subscription_version: '1',
    },
    payload: {
      subscription: {
        id: 'sub-1',
        status: 'enabled',
        type: 'channel.chat.message',
        version: '1',
        cost: 0,
        condition: { broadcaster_user_id: event.broadcaster_user_id },
        transport: { method: 'websocket' },
        created_at: new Date().toISOString(),
      },
      event,
    },
  },
})

describe('ProxyClient', () => {
  beforeEach(() => {
    useMultiStreamStore.getState().reset()
    useMultiStreamStore.getState().addStream({
      login: 'alice',
      displayName: 'Alice',
      broadcasterId: 'b_alice',
    })
    useMultiStreamStore.getState().addStream({
      login: 'bob',
      displayName: 'Bob',
      broadcasterId: 'b_bob',
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('createSession POSTs channels/user_id/access_token and returns sessionId', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ session_id: 'sess-xyz' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      fetchImpl,
    })

    const { sessionId } = await client.createSession({
      channels: [
        { login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' },
        { login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' },
      ],
      userId: 'u1',
      accessToken: 'tok',
    })

    expect(sessionId).toBe('sess-xyz')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    const url = call[0] as string
    const init = call[1] as RequestInit
    expect(url).toBe('http://proxy.test/session')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      channels: ['alice', 'bob'],
      user_id: 'u1',
      access_token: 'tok',
    })
  })

  it('createSession throws ProxyError on 4xx/5xx', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('bad', { status: 500 }),
    ) as unknown as typeof fetch

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      fetchImpl,
    })

    await expect(
      client.createSession({
        channels: [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }],
        userId: 'u1',
        accessToken: 'tok',
      }),
    ).rejects.toBeInstanceOf(ProxyError)
  })

  it('connect opens WS and routes channel.chat.message to the correct slice', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ session_id: 'sess-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const sockets: FakeSocket[] = []
    const createSocket = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s as unknown as WebSocket
    }

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      fetchImpl,
      createSocket,
    })

    const { sessionId } = await client.createSession({
      channels: [
        { login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' },
        { login: 'bob', displayName: 'Bob', broadcasterId: 'b_bob' },
      ],
      userId: 'u1',
      accessToken: 'tok',
    })

    const connectPromise = client.connect(sessionId)
    await flushMicrotasks()

    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.url).toBe('ws://proxy.test/ws/sess-1')
    sockets[0]!.emitOpen()
    await expect(connectPromise).resolves.toBeUndefined()
    expect(client.isConnected()).toBe(true)

    const event = rawChatEvent('alice', 'u1', 'hello')
    sockets[0]!.emitMessage(chatEnvelope('alice', event))

    const alice = useMultiStreamStore.getState().streams.alice
    const bob = useMultiStreamStore.getState().streams.bob
    expect(alice?.messages).toHaveLength(1)
    expect(alice?.messages[0]?.text).toBe('hello')
    expect(alice?._counter).toBe(1)
    expect(bob?.messages).toHaveLength(0)

    await client.disconnect()
  })

  it('routes channel.raid envelopes through annotationFromEvent into the correct slice', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ session_id: 'sess-2' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const sockets: FakeSocket[] = []
    const createSocket = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s as unknown as WebSocket
    }

    const client = new ProxyClient({
      proxyUrl: 'https://proxy.test',
      fetchImpl,
      createSocket,
    })

    const { sessionId } = await client.createSession({
      channels: [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }],
      userId: 'u1',
      accessToken: 'tok',
    })

    const connectPromise = client.connect(sessionId)
    await flushMicrotasks()
    expect(sockets[0]!.url).toBe('wss://proxy.test/ws/sess-2')
    sockets[0]!.emitOpen()
    await connectPromise

    const raidEnv: ProxyEnvelope = {
      stream_login: 'alice',
      event_type: 'channel.raid',
      payload: {
        metadata: {
          message_id: 'm-raid',
          message_type: 'notification',
          message_timestamp: new Date().toISOString(),
          subscription_type: 'channel.raid',
          subscription_version: '1',
        },
        payload: {
          subscription: {
            id: 'sub-raid',
            status: 'enabled',
            type: 'channel.raid',
            version: '1',
            cost: 0,
            condition: { to_broadcaster_user_id: 'b_alice' },
            transport: { method: 'websocket' },
            created_at: new Date().toISOString(),
          },
          event: {
            from_broadcaster_user_id: 'fb',
            from_broadcaster_user_login: 'xqc',
            from_broadcaster_user_name: 'xQc',
            to_broadcaster_user_id: 'b_alice',
            to_broadcaster_user_login: 'alice',
            to_broadcaster_user_name: 'Alice',
            viewers: 1200,
          },
        },
      },
    }
    sockets[0]!.emitMessage(raidEnv)

    const alice = useMultiStreamStore.getState().streams.alice
    expect(alice?.annotations).toHaveLength(1)
    expect(alice?.annotations[0]?.type).toBe('raid')
    expect(alice?.annotations[0]?.label).toBe('Raid from xQc (1,200 viewers)')

    await client.disconnect()
  })

  it('upstream_lost error frame marks the slice as degraded and does NOT close the WS', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ session_id: 'sess-3' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const sockets: FakeSocket[] = []
    const createSocket = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s as unknown as WebSocket
    }

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      fetchImpl,
      createSocket,
    })

    const { sessionId } = await client.createSession({
      channels: [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }],
      userId: 'u1',
      accessToken: 'tok',
    })
    const connectPromise = client.connect(sessionId)
    await flushMicrotasks()
    sockets[0]!.emitOpen()
    await connectPromise

    sockets[0]!.emitMessage({ error: 'upstream_lost', stream_login: 'alice' })

    expect(useMultiStreamStore.getState().streams.alice?.isDegraded).toBe(true)
    // bob is not affected
    expect(useMultiStreamStore.getState().streams.bob?.isDegraded).toBe(false)
    // Crucially, the WS is NOT closed by the upstream_lost frame.
    expect(sockets[0]!.close).not.toHaveBeenCalled()
    expect(client.isConnected()).toBe(true)

    await client.disconnect()
  })

  it('connect rejects when the WS errors before open', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ session_id: 'sess-err' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const sockets: FakeSocket[] = []
    const createSocket = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s as unknown as WebSocket
    }

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      fetchImpl,
      createSocket,
    })

    const { sessionId } = await client.createSession({
      channels: [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }],
      userId: 'u1',
      accessToken: 'tok',
    })

    const connectPromise = client.connect(sessionId)
    await flushMicrotasks()
    sockets[0]!.emitError()

    await expect(connectPromise).rejects.toThrow(/proxy_ws_error/)
  })

  it('disconnect sends DELETE, closes the WS, and clears the tick interval (no more tickAll)', async () => {
    vi.useFakeTimers()

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      if (typeof input === 'string' && input.endsWith('/session')) {
        return new Response(JSON.stringify({ session_id: 'sess-dc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('', { status: 204 })
    }) as unknown as typeof fetch

    const sockets: FakeSocket[] = []
    const createSocket = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s as unknown as WebSocket
    }

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      fetchImpl,
      createSocket,
    })

    const { sessionId } = await client.createSession({
      channels: [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }],
      userId: 'u1',
      accessToken: 'tok',
    })

    const connectPromise = client.connect(sessionId)
    await flushMicrotasks()
    sockets[0]!.emitOpen()
    await connectPromise

    // Spy on tickAll: the interval should be running right now.
    const tickSpy = vi.spyOn(useMultiStreamStore.getState(), 'tickAll')
    // Reach through the zustand API to also cover subsequent getState() lookups,
    // since ProxyClient calls useMultiStreamStore.getState().tickAll() at interval time.
    const originalTickAll = useMultiStreamStore.getState().tickAll
    const tickAllWrap = vi.fn(() => originalTickAll())
    useMultiStreamStore.setState({ tickAll: tickAllWrap })

    vi.advanceTimersByTime(2500)
    expect(tickAllWrap).toHaveBeenCalled()
    const callsBeforeDisconnect = tickAllWrap.mock.calls.length
    expect(callsBeforeDisconnect).toBeGreaterThanOrEqual(2)

    await client.disconnect()

    // DELETE hit the right URL.
    const deleteCall = fetchCalls.find((c) => c.init?.method === 'DELETE')
    expect(deleteCall?.url).toBe('http://proxy.test/session/sess-dc')

    // WS closed.
    expect(sockets[0]!.close).toHaveBeenCalled()
    expect(client.isConnected()).toBe(false)

    // Interval cleared — no further tick after disconnect.
    vi.advanceTimersByTime(5000)
    expect(tickAllWrap.mock.calls.length).toBe(callsBeforeDisconnect)

    tickSpy.mockRestore()
  })

  it('never leaks the access token into logs during createSession', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const secretToken = 'super-secret-token-ABCxyz-12345'
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ session_id: 'sess-log' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      logger,
      fetchImpl,
    })

    await client.createSession({
      channels: [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }],
      userId: 'u1',
      accessToken: secretToken,
    })

    const allLogCalls = [
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]
    for (const call of allLogCalls) {
      for (const arg of call) {
        const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg ?? '')
        expect(serialized).not.toContain(secretToken)
      }
    }
  })

  it('never leaks the access token into logs during createSession failure', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const secretToken = 'token-leak-check-XYZ'
    const fetchImpl = vi.fn(async () =>
      new Response('bad request', { status: 400 }),
    ) as unknown as typeof fetch

    const client = new ProxyClient({
      proxyUrl: 'http://proxy.test',
      logger,
      fetchImpl,
    })

    await expect(
      client.createSession({
        channels: [{ login: 'alice', displayName: 'Alice', broadcasterId: 'b_alice' }],
        userId: 'u1',
        accessToken: secretToken,
      }),
    ).rejects.toBeInstanceOf(ProxyError)

    const allLogCalls = [
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]
    for (const call of allLogCalls) {
      for (const arg of call) {
        const serialized = typeof arg === 'string' ? arg : JSON.stringify(arg ?? '')
        expect(serialized).not.toContain(secretToken)
      }
    }
  })
})
