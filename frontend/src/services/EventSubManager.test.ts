import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '../lib/logger'
import { EventSubManager } from './EventSubManager'
import { HelixError, type TwitchHelixClient } from './TwitchHelixClient'

// Mock the Zustand store singletons at module boundary so the manager
// doesn't touch real state when it handles notifications or runs the
// heatmap tick. Actions are hoisted so tests can assert routing.
const { chatActions, heatmapActions } = vi.hoisted(() => ({
  chatActions: {
    addMessage: vi.fn(),
    addSystemEvent: vi.fn(),
    applyDeletion: vi.fn(),
    applyUserClear: vi.fn(),
    applyChatClear: vi.fn(),
    addPin: vi.fn(),
    removePin: vi.fn(),
  },
  heatmapActions: {
    incrementCounter: vi.fn(),
    tick: vi.fn(),
    addAnnotation: vi.fn(),
  },
}))

vi.mock('../store/chatStore', () => ({
  useChatStore: {
    getState: () => chatActions,
  },
}))

vi.mock('../store/heatmapStore', () => ({
  useHeatmapStore: {
    getState: () => heatmapActions,
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
    for (const fn of Object.values(chatActions)) fn.mockReset()
    for (const fn of Object.values(heatmapActions)) fn.mockReset()
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

    expect(createEventSubSubscription).toHaveBeenCalledTimes(10)

    const forbiddenCalls = warnSpy.mock.calls.filter(
      (args) => args[0] === 'eventsub.subscribe.forbidden',
    )
    expect(forbiddenCalls.length).toBeGreaterThanOrEqual(4)

    // Phase 6 subscriptions are appended after the Phase 1 set.
    const types = createEventSubSubscription.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(types).toContain('channel.chat.notification')
    expect(types).toContain('channel.chat.message_delete')
    expect(types).toContain('channel.chat.clear_user_messages')
    expect(types).toContain('channel.chat.clear')

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

  // ---------------------------------------------------------------------------
  // Phase 6 — routing of new notification types
  // ---------------------------------------------------------------------------

  const notificationFrame = (subscriptionType: string, event: unknown) => ({
    metadata: {
      message_id: `m-${subscriptionType}-${Math.random().toString(36).slice(2)}`,
      message_type: 'notification',
      message_timestamp: new Date().toISOString(),
      subscription_type: subscriptionType,
      subscription_version: '1',
    },
    payload: {
      subscription: {
        id: `sub-${subscriptionType}`,
        type: subscriptionType,
        version: '1',
        status: 'enabled',
        cost: 0,
        condition: {},
        transport: { method: 'websocket', session_id: 'sess-1' },
        created_at: new Date().toISOString(),
      },
      event,
    },
  })

  const bootManager = async () => {
    const createEventSubSubscription = vi.fn(async () => {})
    const mockHelix = { createEventSubSubscription } as unknown as TwitchHelixClient
    const sockets: FakeSocket[] = []
    const factory = (url: string): WebSocket => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s as unknown as WebSocket
    }
    const manager = new EventSubManager(mockHelix, factory)
    const connectPromise = manager.connect({ broadcasterId: 'b1', userId: 'u1', token: 't' })
    await flushMicrotasks()
    sockets[0]!.emitMessage(welcomeFrame('sess-1'))
    await connectPromise
    await flushMicrotasks()
    return { manager, socket: sockets[0]! }
  }

  it('routes channel.chat.notification "raid" notice to chatStore.addSystemEvent', async () => {
    const { manager, socket } = await bootManager()
    socket.emitMessage(
      notificationFrame('channel.chat.notification', {
        broadcaster_user_id: 'b1',
        broadcaster_user_login: 'broadcaster',
        broadcaster_user_name: 'Broadcaster',
        chatter_user_id: 'u2',
        chatter_user_login: 'charlie',
        chatter_user_name: 'Charlie',
        chatter_is_anonymous: false,
        color: '#ffffff',
        badges: [],
        system_message: '',
        message_id: 'n1',
        message: { text: '', fragments: [] },
        notice_type: 'raid',
        raid: {
          user_id: 'u2',
          user_login: 'charlie',
          user_name: 'Charlie',
          viewer_count: 42,
          profile_image_url: '',
        },
      }),
    )
    expect(chatActions.addSystemEvent).toHaveBeenCalledTimes(1)
    const arg = chatActions.addSystemEvent.mock.calls[0]![0] as { noticeType: string }
    expect(arg.noticeType).toBe('raid')
    expect(chatActions.addPin).not.toHaveBeenCalled()
    manager.disconnect()
  })

  it('routes channel.chat.notification "pin_chat_message" notice to chatStore.addPin', async () => {
    const { manager, socket } = await bootManager()
    socket.emitMessage(
      notificationFrame('channel.chat.notification', {
        broadcaster_user_id: 'b1',
        broadcaster_user_login: 'broadcaster',
        broadcaster_user_name: 'Broadcaster',
        chatter_user_id: 'mod',
        chatter_user_login: 'mod',
        chatter_user_name: 'Mod',
        chatter_is_anonymous: false,
        color: '#ffffff',
        badges: [],
        system_message: '',
        message_id: 'p1',
        message: { text: '', fragments: [] },
        notice_type: 'pin_chat_message',
        pin_chat_message: { message: { id: 'm99', text: 'Pinned!' } },
      }),
    )
    expect(chatActions.addPin).toHaveBeenCalledTimes(1)
    expect(chatActions.addSystemEvent).not.toHaveBeenCalled()
    manager.disconnect()
  })

  it('routes channel.chat.notification "unpin_chat_message" notice to chatStore.removePin', async () => {
    const { manager, socket } = await bootManager()
    socket.emitMessage(
      notificationFrame('channel.chat.notification', {
        broadcaster_user_id: 'b1',
        broadcaster_user_login: 'broadcaster',
        broadcaster_user_name: 'Broadcaster',
        chatter_user_id: 'mod',
        chatter_user_login: 'mod',
        chatter_user_name: 'Mod',
        chatter_is_anonymous: false,
        color: '#ffffff',
        badges: [],
        system_message: '',
        message_id: 'u1',
        message: { text: '', fragments: [] },
        notice_type: 'unpin_chat_message',
        unpin_chat_message: { message: { id: 'm99' } },
      }),
    )
    expect(chatActions.removePin).toHaveBeenCalledWith('m99')
    expect(chatActions.addPin).not.toHaveBeenCalled()
    manager.disconnect()
  })

  it('routes channel.chat.message_delete to chatStore.applyDeletion(message_id)', async () => {
    const { manager, socket } = await bootManager()
    socket.emitMessage(
      notificationFrame('channel.chat.message_delete', {
        broadcaster_user_id: 'b1',
        broadcaster_user_login: 'broadcaster',
        broadcaster_user_name: 'Broadcaster',
        target_user_id: 'u5',
        target_user_login: 'victim',
        target_user_name: 'Victim',
        message_id: 'm-deleted',
      }),
    )
    expect(chatActions.applyDeletion).toHaveBeenCalledWith('m-deleted')
    manager.disconnect()
  })

  it('routes channel.chat.clear_user_messages to chatStore.applyUserClear(target_user_id)', async () => {
    const { manager, socket } = await bootManager()
    socket.emitMessage(
      notificationFrame('channel.chat.clear_user_messages', {
        broadcaster_user_id: 'b1',
        broadcaster_user_login: 'broadcaster',
        broadcaster_user_name: 'Broadcaster',
        target_user_id: 'u5',
        target_user_login: 'spammer',
        target_user_name: 'Spammer',
      }),
    )
    expect(chatActions.applyUserClear).toHaveBeenCalledWith('u5')
    manager.disconnect()
  })

  it('routes channel.chat.clear to chatStore.applyChatClear()', async () => {
    const { manager, socket } = await bootManager()
    socket.emitMessage(
      notificationFrame('channel.chat.clear', {
        broadcaster_user_id: 'b1',
        broadcaster_user_login: 'broadcaster',
        broadcaster_user_name: 'Broadcaster',
      }),
    )
    expect(chatActions.applyChatClear).toHaveBeenCalledTimes(1)
    manager.disconnect()
  })

  it('ignores unknown notice_type on channel.chat.notification without crashing or calling any store action', async () => {
    const { manager, socket } = await bootManager()
    socket.emitMessage(
      notificationFrame('channel.chat.notification', {
        broadcaster_user_id: 'b1',
        broadcaster_user_login: 'broadcaster',
        broadcaster_user_name: 'Broadcaster',
        chatter_user_id: 'u1',
        chatter_user_login: 'x',
        chatter_user_name: 'X',
        chatter_is_anonymous: false,
        color: '#ffffff',
        badges: [],
        system_message: '',
        message_id: 'n-unknown',
        message: { text: '', fragments: [] },
        notice_type: 'brand_new_event_2030',
      }),
    )
    expect(chatActions.addSystemEvent).not.toHaveBeenCalled()
    expect(chatActions.addPin).not.toHaveBeenCalled()
    manager.disconnect()
  })
})
