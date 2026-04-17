import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../lib/logger'
import { EventSubManager } from './EventSubManager'
import { HelixError, type TwitchHelixClient } from './TwitchHelixClient'

// Mock the Zustand store singletons at module boundary so the manager
// doesn't touch real state when it handles notifications or runs the
// heatmap tick.
vi.mock('../store/chatStore', () => ({
  useChatStore: {
    getState: () => ({ addMessage: vi.fn() }),
  },
}))

vi.mock('../store/heatmapStore', () => ({
  useHeatmapStore: {
    getState: () => ({
      incrementCounter: vi.fn(),
      tick: vi.fn(),
      addAnnotation: vi.fn(),
    }),
  },
}))

// Minimal fake WebSocket used for both tests. Settable handlers mirror the
// real WebSocket, and `emitMessage` lets tests drive the manager's state
// machine by dispatching onmessage with arbitrary JSON frames.
class FakeSocket {
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null

  send = vi.fn()
  close = vi.fn()

  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  emitMessage(data: unknown): void {
    const ev = { data: JSON.stringify(data) } as MessageEvent
    this.onmessage?.(ev)
  }
}

const welcomeFrame = (sessionId: string) => ({
  metadata: {
    message_id: `m-${sessionId}`,
    message_type: 'session_welcome',
    message_timestamp: new Date().toISOString(),
  },
  payload: {
    session: {
      id: sessionId,
      status: 'connected',
      connected_at: new Date().toISOString(),
      keepalive_timeout_seconds: 10,
      reconnect_url: null,
    },
  },
})

const reconnectFrame = (reconnectUrl: string) => ({
  metadata: {
    message_id: 'm-reconnect',
    message_type: 'session_reconnect',
    message_timestamp: new Date().toISOString(),
  },
  payload: {
    session: {
      id: 'sess-1',
      status: 'reconnecting',
      connected_at: new Date().toISOString(),
      keepalive_timeout_seconds: 10,
      reconnect_url: reconnectUrl,
    },
  },
})

// Flush pending microtasks (e.g. awaited promises after onWelcome fires).
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

describe('EventSubManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('tolerates 403 HelixError on optional subscriptions and resolves connect()', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const createEventSubSubscription = vi.fn(async (body: unknown) => {
      const b = body as { type: string }
      if (b.type === 'channel.chat.message' || b.type === 'channel.raid') {
        return
      }
      throw new HelixError(403, 'forbidden')
    })
    const mockHelix = {
      createEventSubSubscription,
    } as unknown as TwitchHelixClient

    const sockets: FakeSocket[] = []
    const factory = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s as unknown as WebSocket
    }

    const manager = new EventSubManager(mockHelix, factory)

    const connectPromise = manager.connect({
      broadcasterId: 'b1',
      userId: 'u1',
      token: 't',
    })

    // Let connect() run up to the point where it's awaiting session_welcome.
    await flushMicrotasks()

    expect(sockets).toHaveLength(1)
    sockets[0]!.emitMessage(welcomeFrame('sess-1'))

    await expect(connectPromise).resolves.toBeUndefined()

    // Allow registerAllSubscriptions to iterate through all 6 specs.
    await flushMicrotasks()

    expect(createEventSubSubscription).toHaveBeenCalledTimes(6)

    const forbiddenCalls = warnSpy.mock.calls.filter(
      (args) => args[0] === 'eventsub.subscribe.forbidden',
    )
    expect(forbiddenCalls.length).toBeGreaterThanOrEqual(4)

    manager.disconnect()
  })

  it('handles session_reconnect: opens new socket before closing the old one', async () => {
    const createEventSubSubscription = vi.fn(async () => {})
    const mockHelix = {
      createEventSubSubscription,
    } as unknown as TwitchHelixClient

    const sockets: FakeSocket[] = []
    let callOrderCounter = 0
    const socketConstructionOrder: number[] = []
    const oldSocketCloseOrder: number[] = []

    const factory = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      socketConstructionOrder.push(++callOrderCounter)
      const originalClose = s.close
      s.close = vi.fn((...args: unknown[]) => {
        oldSocketCloseOrder.push(++callOrderCounter)
        return originalClose.apply(s, args as [])
      })
      return s as unknown as WebSocket
    }

    const manager = new EventSubManager(mockHelix, factory)

    const connectPromise = manager.connect({
      broadcasterId: 'b1',
      userId: 'u1',
      token: 't',
    })

    await flushMicrotasks()
    expect(sockets).toHaveLength(1)

    sockets[0]!.emitMessage(welcomeFrame('sess-1'))
    await expect(connectPromise).resolves.toBeUndefined()
    await flushMicrotasks()

    // Trigger reconnect on socket[0].
    sockets[0]!.emitMessage(
      reconnectFrame('wss://eventsub.wss.twitch.tv/ws?reconnect=abc'),
    )

    // reconnectTo is fired via `void`; allow it to construct socket[1].
    await flushMicrotasks()

    expect(sockets).toHaveLength(2)
    // socket[0] must not have been closed yet — we haven't welcomed socket[1].
    expect(sockets[0]!.close).not.toHaveBeenCalled()

    // Welcome the new socket so openSocket resolves and the finally block runs.
    sockets[1]!.emitMessage(welcomeFrame('sess-2'))
    await flushMicrotasks()

    expect(sockets[0]!.close).toHaveBeenCalledTimes(1)

    // Factory was called twice (initial + reconnect).
    expect(socketConstructionOrder).toHaveLength(2)
    // socket[0] construction < socket[1] construction < socket[0].close.
    expect(socketConstructionOrder[0]!).toBeLessThan(socketConstructionOrder[1]!)
    expect(oldSocketCloseOrder).toHaveLength(1)
    expect(socketConstructionOrder[1]!).toBeLessThan(oldSocketCloseOrder[0]!)

    manager.disconnect()
  })
})
