import { logger, setGlobalCorrelationId } from '../lib/logger'
import { buildPinnedMessage, buildSystemEvent } from '../store/chatMessageMapper'
import { useChatStore } from '../store/chatStore'
import { useHeatmapStore } from '../store/heatmapStore'
import { useIntelligenceStore } from '../store/intelligenceStore'
import { useSemanticStore } from '../store/semanticStore'
import type {
  ChannelChatClearEvent,
  ChannelChatClearUserMessagesEvent,
  ChannelChatMessageDeleteEvent,
  ChannelChatMessageEvent,
  ChannelChatNotificationEvent,
  EventSubFrame,
  EventSubNotificationPayload,
  EventSubSessionReconnectPayload,
  EventSubSessionWelcomePayload,
} from '../types/twitch'
import { annotationFromEvent } from './annotationFromEvent'
import { recordLatencySample } from './EventSubLatencyChannel'
import type { TwitchHelixClient } from './TwitchHelixClient'
import { HelixError } from './TwitchHelixClient'

const EVENTSUB_WS_URL = 'wss://eventsub.wss.twitch.tv/ws'
const TICK_INTERVAL_MS = 1000
const MOMENT_DETECT_TICKS = 5

export interface EventSubConnectArgs {
  broadcasterId: string
  userId: string
  token: string
}

interface SubscriptionSpec {
  type: string
  version: string
  condition: Record<string, string>
}

const buildSubscriptionSpecs = (broadcasterId: string, userId: string): SubscriptionSpec[] => [
  {
    type: 'channel.chat.message',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId, user_id: userId },
  },
  {
    type: 'channel.subscribe',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.subscription.gift',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.raid',
    version: '1',
    condition: { to_broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.hype_train.begin',
    version: '2',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.hype_train.end',
    version: '2',
    condition: { broadcaster_user_id: broadcasterId },
  },
  {
    type: 'channel.chat.notification',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId, user_id: userId },
  },
  {
    type: 'channel.chat.message_delete',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId, user_id: userId },
  },
  {
    type: 'channel.chat.clear_user_messages',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId, user_id: userId },
  },
  {
    type: 'channel.chat.clear',
    version: '1',
    condition: { broadcaster_user_id: broadcasterId, user_id: userId },
  },
]

export class EventSubManager {
  private helix: TwitchHelixClient
  private ws: WebSocket | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private tickCounter = 0
  private sessionId: string | null = null
  private correlationId: string | null = null
  private args: EventSubConnectArgs | null = null
  private createSocket: (url: string) => WebSocket

  constructor(helix: TwitchHelixClient, createSocket?: (url: string) => WebSocket) {
    this.helix = helix
    this.createSocket = createSocket ?? ((url: string) => new WebSocket(url))
  }

  async connect(args: EventSubConnectArgs): Promise<void> {
    this.args = args
    this.correlationId = `session-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
    setGlobalCorrelationId(this.correlationId)
    logger.info('eventsub.connect.begin', { broadcasterId: args.broadcasterId })

    await this.openSocket(EVENTSUB_WS_URL)
    this.startHeatmapTick()
  }

  disconnect(): void {
    logger.info('eventsub.disconnect')
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onerror = null
      this.ws.onclose = null
      this.ws.close()
      this.ws = null
    }
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    // Clear every piece of per-session state so a subsequent connect() starts
    // from a blank slate. Keeping stale args/correlationId around meant a
    // disconnect → connect cycle (e.g. exiting multi-stream) could race a
    // late welcome frame from the old socket against the new session's
    // registration and silently drop subscriptions.
    this.sessionId = null
    this.correlationId = null
    this.args = null
  }

  private openSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.createSocket(url)
      this.ws = socket

      const welcomeTimeout = setTimeout(() => {
        logger.error('eventsub.welcome.timeout')
        reject(new Error('session_welcome_timeout'))
      }, 10_000)

      socket.onmessage = (ev: MessageEvent) => {
        try {
          this.handleFrame(ev.data as string, {
            onWelcome: () => {
              clearTimeout(welcomeTimeout)
              resolve()
            },
          })
        } catch (err) {
          logger.error('eventsub.message.error', { error: String(err) })
        }
      }
      socket.onerror = () => {
        logger.error('eventsub.socket.error')
      }
      socket.onclose = (ev) => {
        logger.warn('eventsub.socket.close', { code: ev.code, reason: ev.reason })
      }
    })
  }

  private startHeatmapTick(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickCounter = 0
    this.tickTimer = setInterval(() => {
      const now = Date.now()
      useHeatmapStore.getState().tick()
      useIntelligenceStore.getState().tick(now)
      this.tickCounter = (this.tickCounter + 1) % MOMENT_DETECT_TICKS
      if (this.tickCounter === 0) useSemanticStore.getState().detectMoments(now)
    }, TICK_INTERVAL_MS)
  }

  private handleFrame(data: string, callbacks: { onWelcome: () => void }): void {
    const frame = JSON.parse(data) as EventSubFrame
    const { metadata } = frame

    if (metadata.message_type === 'notification' || metadata.message_type === 'session_keepalive') {
      try {
        recordLatencySample(Date.now(), metadata.message_timestamp)
      } catch (err) {
        logger.warn('perf.latency.parse_error', { error: String(err) })
      }
    }

    if (metadata.message_type === 'session_welcome') {
      const payload = frame.payload as EventSubSessionWelcomePayload
      this.sessionId = payload.session.id
      logger.info('eventsub.session_welcome', { sessionId: this.sessionId })
      callbacks.onWelcome()
      void this.registerAllSubscriptions()
      return
    }

    if (metadata.message_type === 'session_keepalive') {
      logger.debug('eventsub.keepalive')
      return
    }

    if (metadata.message_type === 'session_reconnect') {
      const payload = frame.payload as EventSubSessionReconnectPayload
      logger.info('eventsub.session_reconnect', { reconnectUrl: payload.session.reconnect_url })
      void this.reconnectTo(payload.session.reconnect_url)
      return
    }

    if (metadata.message_type === 'revocation') {
      logger.warn('eventsub.revocation', { subscriptionType: metadata.subscription_type })
      return
    }

    if (metadata.message_type === 'notification') {
      this.handleNotification(frame.payload as EventSubNotificationPayload, metadata.subscription_type)
      return
    }
  }

  private handleNotification(
    payload: EventSubNotificationPayload,
    subscriptionType: string | undefined,
  ): void {
    logger.debug('eventsub.notification', { subscriptionType })

    if (subscriptionType === 'channel.chat.message') {
      const event = payload.event as ChannelChatMessageEvent
      useChatStore.getState().addMessage(event)
      useHeatmapStore.getState().incrementCounter()
      const chat = useChatStore.getState()
      const built = chat.messagesById[event.message_id]
      const session = chat.session
      if (built) {
        if (session) {
          useIntelligenceStore.getState().ingestMessage(built, undefined, {
            login: session.broadcasterLogin,
            displayName: session.broadcasterDisplayName,
          })
        } else {
          logger.warn('intelligence.ingest.no_session', { messageId: event.message_id })
        }
        if (useSemanticStore.getState().status === 'ready') {
          useSemanticStore.getState().ingestMessage(built, undefined, built.timestamp.getTime())
        }
      }
      return
    }

    if (subscriptionType === 'channel.chat.notification') {
      this.routeChatNotification(payload.event as ChannelChatNotificationEvent)
      return
    }

    if (subscriptionType === 'channel.chat.message_delete') {
      const event = payload.event as ChannelChatMessageDeleteEvent
      useChatStore.getState().applyDeletion(event.message_id)
      return
    }

    if (subscriptionType === 'channel.chat.clear_user_messages') {
      const event = payload.event as ChannelChatClearUserMessagesEvent
      useChatStore.getState().applyUserClear(event.target_user_id)
      return
    }

    if (subscriptionType === 'channel.chat.clear') {
      // Discriminator-only assertion — payload carries no ids we route on.
      const _event = payload.event as ChannelChatClearEvent
      void _event
      useChatStore.getState().applyChatClear()
      return
    }

    const annotation = subscriptionType ? annotationFromEvent(subscriptionType, payload.event) : null
    if (annotation) {
      useHeatmapStore.getState().addAnnotation({
        timestamp: Date.now(),
        type: annotation.type,
        label: annotation.label,
      })
    }
  }

  private routeChatNotification(event: ChannelChatNotificationEvent): void {
    if (event.notice_type === 'unpin_chat_message' && event.unpin_chat_message) {
      useChatStore.getState().removePin(event.unpin_chat_message.message.id)
      return
    }
    const pin = buildPinnedMessage(event)
    if (pin) {
      useChatStore.getState().addPin(pin)
      return
    }
    const sysEvent = buildSystemEvent(event)
    if (sysEvent) {
      useChatStore.getState().addSystemEvent(sysEvent)
      return
    }
    logger.debug('eventsub.notification.unknown_notice_type', { noticeType: event.notice_type })
  }

  private async registerAllSubscriptions(): Promise<void> {
    if (!this.args || !this.sessionId) return
    const specs = buildSubscriptionSpecs(this.args.broadcasterId, this.args.userId)

    for (const spec of specs) {
      const body = {
        type: spec.type,
        version: spec.version,
        condition: spec.condition,
        transport: { method: 'websocket', session_id: this.sessionId },
      }
      try {
        await this.helix.createEventSubSubscription(body)
        logger.info('eventsub.subscribe.ok', { type: spec.type })
      } catch (err) {
        if (err instanceof HelixError && err.status === 403) {
          logger.warn('eventsub.subscribe.forbidden', {
            type: spec.type,
            reason: 'not available for this channel (not viewer\'s own)',
          })
          continue
        }
        logger.error('eventsub.subscribe.error', { type: spec.type, error: String(err) })
      }
    }
  }

  private async reconnectTo(reconnectUrl: string): Promise<void> {
    const oldWs = this.ws
    try {
      await this.openSocket(reconnectUrl)
    } finally {
      if (oldWs && oldWs !== this.ws) {
        oldWs.onopen = null
        oldWs.onmessage = null
        oldWs.onerror = null
        oldWs.onclose = null
        oldWs.close()
      }
    }
  }
}
