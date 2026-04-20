import { logger as defaultLogger, setGlobalCorrelationId } from '../../lib/logger'
import { annotationFromEvent } from '../../services/annotationFromEvent'
import { recordLatencySample } from '../../services/EventSubLatencyChannel'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import type {
  ChannelChatMessageEvent,
  EventSubFrame,
  EventSubNotificationPayload,
  ProxyEnvelope,
  ProxyErrorFrame,
} from '../../types/twitch'

const TICK_INTERVAL_MS = 1000

type Logger = typeof defaultLogger

export interface ProxyClientDeps {
  proxyUrl: string
  logger?: Logger
  fetchImpl?: typeof fetch
  createSocket?: (url: string) => WebSocket
}

export interface ProxyChannel {
  login: string
  displayName: string
  broadcasterId: string
}

export interface CreateSessionArgs {
  channels: ProxyChannel[]
  userId: string
  accessToken: string
}

export interface CreateSessionResult {
  sessionId: string
}

export interface PatchSessionArgs {
  sessionId: string
  add: ProxyChannel[]
  remove: string[]
  userId: string
  accessToken: string
}

export interface PatchSessionResult {
  sessionId: string
  channels: string[]
}

export class ProxyError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`proxy request failed: ${status}`)
    this.name = 'ProxyError'
    this.status = status
    this.body = body
  }
}

const httpToWs = (url: string): string => {
  if (url.startsWith('https://')) return `wss://${url.slice('https://'.length)}`
  if (url.startsWith('http://')) return `ws://${url.slice('http://'.length)}`
  return url
}

const isProxyErrorFrame = (x: unknown): x is ProxyErrorFrame =>
  typeof x === 'object' &&
  x !== null &&
  (x as { error?: unknown }).error === 'upstream_lost' &&
  typeof (x as { stream_login?: unknown }).stream_login === 'string'

const isProxyEnvelope = (x: unknown): x is ProxyEnvelope =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as { stream_login?: unknown }).stream_login === 'string' &&
  typeof (x as { event_type?: unknown }).event_type === 'string'

export class ProxyClient {
  private proxyUrl: string
  private logger: Logger
  private fetchImpl: typeof fetch
  private createSocket: (url: string) => WebSocket
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null

  constructor(deps: ProxyClientDeps) {
    this.proxyUrl = deps.proxyUrl
    this.logger = deps.logger ?? defaultLogger
    this.fetchImpl = deps.fetchImpl ?? fetch.bind(globalThis)
    this.createSocket = deps.createSocket ?? ((url: string) => new WebSocket(url))
  }

  async createSession(args: CreateSessionArgs): Promise<CreateSessionResult> {
    const url = `${this.proxyUrl}/session`
    const body = JSON.stringify({
      channels: args.channels.map((c) => c.login),
      user_id: args.userId,
      access_token: args.accessToken,
    })

    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      this.logger.warn('proxy.session.create_failed', { status: response.status, body: text })
      throw new ProxyError(response.status, text)
    }

    const parsed = (await response.json()) as { session_id: string }
    this.sessionId = parsed.session_id
    setGlobalCorrelationId(parsed.session_id)
    this.logger.info('proxy.session.created', {
      sessionId: parsed.session_id,
      channels: args.channels.map((c) => c.login),
    })

    return { sessionId: parsed.session_id }
  }

  async patchSession(args: PatchSessionArgs): Promise<PatchSessionResult> {
    const url = `${this.proxyUrl}/session/${args.sessionId}`
    const body = JSON.stringify({
      add: args.add.map((c) => c.login),
      remove: args.remove,
      user_id: args.userId,
      access_token: args.accessToken,
    })

    const response = await this.fetchImpl(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      this.logger.warn('proxy.session.patch_failed', { status: response.status, body: text })
      throw new ProxyError(response.status, text)
    }

    const parsed = (await response.json()) as { session_id: string; channels: string[] }
    this.logger.info('proxy.session.patched', {
      sessionId: parsed.session_id,
      added: args.add.map((c) => c.login),
      removed: args.remove,
      channels: parsed.channels,
    })
    return { sessionId: parsed.session_id, channels: parsed.channels }
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  connect(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsBase = httpToWs(this.proxyUrl)
      const url = `${wsBase}/ws/${sessionId}`
      const socket = this.createSocket(url)
      this.ws = socket
      this.sessionId = sessionId

      let settled = false

      socket.onopen = () => {
        if (settled) return
        settled = true
        this.logger.info('proxy.ws.open', { sessionId })
        this.startTick()
        resolve()
      }
      socket.onerror = () => {
        this.logger.error('proxy.ws.error', { sessionId })
        if (!settled) {
          settled = true
          reject(new Error('proxy_ws_error'))
        }
      }
      socket.onclose = (ev) => {
        this.logger.warn('proxy.ws.close', { sessionId, code: ev.code, reason: ev.reason })
        this.stopTick()
      }
      socket.onmessage = (ev: MessageEvent) => {
        try {
          this.handleFrame(ev.data as string)
        } catch (err) {
          this.logger.error('proxy.ws.message_error', { error: String(err) })
        }
      }
    })
  }

  async disconnect(): Promise<void> {
    this.logger.info('proxy.disconnect', { sessionId: this.sessionId })
    const sid = this.sessionId
    this.stopTick()

    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }

    if (sid) {
      try {
        await this.fetchImpl(`${this.proxyUrl}/session/${sid}`, { method: 'DELETE' })
      } catch (err) {
        this.logger.warn('proxy.session.delete_failed', { error: String(err) })
      }
    }

    this.sessionId = null
  }

  isConnected(): boolean {
    return this.ws !== null
  }

  private startTick(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => {
      useMultiStreamStore.getState().tickAll()
    }, TICK_INTERVAL_MS)
  }

  private stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  private handleFrame(data: string): void {
    const parsed = JSON.parse(data) as unknown

    if (isProxyErrorFrame(parsed)) {
      this.logger.warn('proxy.upstream_lost', { streamLogin: parsed.stream_login })
      useMultiStreamStore.getState().setDegraded(parsed.stream_login, true)
      return
    }

    if (!isProxyEnvelope(parsed)) {
      this.logger.warn('proxy.envelope.malformed')
      return
    }

    const envelope = parsed
    const outerFrame: EventSubFrame = envelope.payload

    // Latency sampling off the upstream metadata timestamp.
    if (
      outerFrame?.metadata?.message_timestamp &&
      (envelope.event_type === 'session_keepalive' ||
        outerFrame.metadata.message_type === 'session_keepalive' ||
        outerFrame.metadata.message_type === 'notification')
    ) {
      try {
        recordLatencySample(Date.now(), outerFrame.metadata.message_timestamp)
      } catch (err) {
        this.logger.warn('proxy.latency.parse_error', { error: String(err) })
      }
    }

    // Any frame tied to a specific channel means that channel's subscription
    // is live upstream — promote it out of the "connecting" state. addMessage
    // does the same for chat frames, but keepalives arrive first and let us
    // clear the spinner for quiet channels.
    useMultiStreamStore.getState().markReady(envelope.stream_login)

    if (envelope.event_type === 'session_keepalive') {
      this.logger.debug('proxy.keepalive', { streamLogin: envelope.stream_login })
      return
    }

    if (envelope.event_type === 'channel.chat.message') {
      const notification = outerFrame.payload as EventSubNotificationPayload
      const event = notification.event as ChannelChatMessageEvent
      const store = useMultiStreamStore.getState()
      store.addMessage(envelope.stream_login, event)
      store.incrementCounter(envelope.stream_login)
      return
    }

    if (
      envelope.event_type === 'channel.raid' ||
      envelope.event_type === 'channel.subscribe' ||
      envelope.event_type === 'channel.subscription.gift' ||
      envelope.event_type === 'channel.hype_train.begin' ||
      envelope.event_type === 'channel.hype_train.end'
    ) {
      const notification = outerFrame.payload as EventSubNotificationPayload
      const info = annotationFromEvent(envelope.event_type, notification.event)
      if (info) {
        useMultiStreamStore.getState().addAnnotation(envelope.stream_login, {
          timestamp: Date.now(),
          type: info.type,
          label: info.label,
        })
      }
      return
    }

    this.logger.warn('ws.envelope.unknown', { eventType: envelope.event_type })
  }
}

const getEnv = (key: string): string => {
  const value = import.meta.env[key]
  return typeof value === 'string' ? value : ''
}

export const createProxyClient = (): ProxyClient =>
  new ProxyClient({
    proxyUrl: getEnv('VITE_PROXY_URL'),
  })
