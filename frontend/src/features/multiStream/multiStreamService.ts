import { logger } from '../../lib/logger'
import { eventSubManager, twitchAuthService } from '../auth/authServices'
import { useChatStore } from '../../store/chatStore'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import type { StreamSession } from '../../types/twitch'
import { ProxyClient } from './ProxyClient'
import type { StreamPick } from './StreamSelector'

/**
 * Narrow service module that owns the multi-stream ProxyClient instance and
 * orchestrates the transitions between single-stream and multi-stream mode.
 *
 * Why a module (not React state): both StreamHeader (entry point) and
 * MultiStreamLayout (exit button) need to trigger these transitions, and the
 * ProxyClient needs to outlive each of their component renders. Threading
 * callbacks through props would couple every intermediate component.
 */

let activeClient: ProxyClient | null = null
let lastEventSubArgs: { broadcasterId: string; userId: string; token: string } | null = null
// Simple in-progress guard so rapid-fire clicks can't race two sessions into
// the registry at the same time.
let inFlight: Promise<void> | null = null

const getProxyUrl = (): string => {
  const value = import.meta.env.VITE_PROXY_URL
  return typeof value === 'string' ? value : ''
}

export interface StartCompareArgs {
  session: StreamSession
  authedUserId: string
  picks: StreamPick[]
  // For testability: tests inject an already-configured client so they can
  // observe the startup sequence without spinning up a real fetch/WebSocket.
  clientFactory?: () => ProxyClient
}

export interface UpdateCompareArgs {
  session: StreamSession
  authedUserId: string
  picks: StreamPick[]
  clientFactory?: () => ProxyClient
}

interface SeedArgs {
  session: StreamSession
  picks: StreamPick[]
}

const seedStore = ({ session, picks }: SeedArgs): void => {
  const store = useMultiStreamStore.getState()
  store.reset()
  store.addStream({
    login: session.broadcasterLogin,
    displayName: session.broadcasterDisplayName,
    broadcasterId: session.broadcasterId,
  })
  for (const pick of picks) {
    store.addStream({
      login: pick.login,
      displayName: pick.displayName,
      broadcasterId: pick.broadcasterId,
    })
  }
}

const buildChannelList = ({ session, picks }: SeedArgs) => [
  {
    login: session.broadcasterLogin,
    displayName: session.broadcasterDisplayName,
    broadcasterId: session.broadcasterId,
  },
  ...picks.map((p) => ({
    login: p.login,
    displayName: p.displayName,
    broadcasterId: p.broadcasterId,
  })),
]

const reconnectSingleStream = async (): Promise<void> => {
  if (!lastEventSubArgs) return
  try {
    await eventSubManager.connect(lastEventSubArgs)
  } catch (err) {
    logger.error('multiStream.reconnect_failed', { error: String(err) })
  }
}

export const startCompare = async (args: StartCompareArgs): Promise<void> => {
  if (inFlight) {
    logger.warn('multiStream.activate.in_flight')
    throw new Error('in_flight')
  }
  if (useMultiStreamStore.getState().isActive) {
    logger.warn('multiStream.activate.already_active')
    throw new Error('already_active')
  }

  const token = twitchAuthService.getToken()
  if (!token) {
    logger.warn('multiStream.activate.no_token')
    throw new Error('no_token')
  }

  // Remember the single-stream args so we can restore EventSub on exit.
  lastEventSubArgs = {
    broadcasterId: args.session.broadcasterId,
    userId: args.authedUserId,
    token,
  }

  // Tear down the single-stream EventSub socket.
  eventSubManager.disconnect()

  seedStore({ session: args.session, picks: args.picks })
  // Flip isActive up front so MultiStreamLayout mounts and each column can
  // render its "connecting" spinner while createSession/connect is in flight.
  useMultiStreamStore.getState().setActive(true)

  const client = args.clientFactory
    ? args.clientFactory()
    : new ProxyClient({ proxyUrl: getProxyUrl() })

  const run = async (): Promise<void> => {
    try {
      const { sessionId } = await client.createSession({
        channels: buildChannelList({ session: args.session, picks: args.picks }),
        userId: args.authedUserId,
        accessToken: token,
      })

      await client.connect(sessionId)
      activeClient = client
      logger.info('multiStream.activate', {
        channels: [args.session.broadcasterLogin, ...args.picks.map((p) => p.login)],
      })
    } catch (err) {
      logger.error('multiStream.activate.failed', { error: String(err) })
      useMultiStreamStore.getState().reset()
      activeClient = null
      await reconnectSingleStream()
      throw err
    }
  }

  const promise = run()
  inFlight = promise.finally(() => {
    inFlight = null
  })
  await promise
}

/**
 * Replace the active multi-stream comparison with a new channel set while
 * keeping the user in multi-stream mode throughout. Used when the user
 * reopens the selector from the header to swap channels.
 */
export const updateCompare = async (args: UpdateCompareArgs): Promise<void> => {
  if (inFlight) {
    logger.warn('multiStream.update.in_flight')
    throw new Error('in_flight')
  }
  if (!useMultiStreamStore.getState().isActive) {
    // Nothing to update — caller should use startCompare instead.
    logger.warn('multiStream.update.not_active')
    throw new Error('not_active')
  }

  const token = twitchAuthService.getToken()
  if (!token) {
    logger.warn('multiStream.update.no_token')
    throw new Error('no_token')
  }

  lastEventSubArgs = {
    broadcasterId: args.session.broadcasterId,
    userId: args.authedUserId,
    token,
  }

  const previousClient = activeClient
  activeClient = null

  const client = args.clientFactory
    ? args.clientFactory()
    : new ProxyClient({ proxyUrl: getProxyUrl() })

  const run = async (): Promise<void> => {
    // Tear down the old proxy session first so the server can drop its
    // subscriptions before we ask it for new ones on the same token.
    if (previousClient) {
      try {
        await previousClient.disconnect()
      } catch (err) {
        logger.warn('multiStream.update.disconnect_error', { error: String(err) })
      }
    }

    // Re-seed slices with the new channel set. setActive stays true so the
    // layout never flashes back to single-stream mode.
    seedStore({ session: args.session, picks: args.picks })
    useMultiStreamStore.getState().setActive(true)

    try {
      const { sessionId } = await client.createSession({
        channels: buildChannelList({ session: args.session, picks: args.picks }),
        userId: args.authedUserId,
        accessToken: token,
      })

      await client.connect(sessionId)
      activeClient = client
      logger.info('multiStream.update', {
        channels: [args.session.broadcasterLogin, ...args.picks.map((p) => p.login)],
      })
    } catch (err) {
      logger.error('multiStream.update.failed', { error: String(err) })
      useMultiStreamStore.getState().reset()
      activeClient = null
      await reconnectSingleStream()
      throw err
    }
  }

  const promise = run()
  inFlight = promise.finally(() => {
    inFlight = null
  })
  await promise
}

export const stopCompare = async (): Promise<void> => {
  if (!useMultiStreamStore.getState().isActive) {
    logger.warn('multiStream.deactivate.not_active')
    return
  }

  const client = activeClient
  activeClient = null

  if (client) {
    try {
      await client.disconnect()
    } catch (err) {
      logger.warn('multiStream.deactivate.disconnect_error', { error: String(err) })
    }
  }

  useMultiStreamStore.getState().reset()

  // Reconnect single-stream EventSub for the original channel.
  if (lastEventSubArgs && useChatStore.getState().session !== null) {
    try {
      await eventSubManager.connect(lastEventSubArgs)
    } catch (err) {
      logger.error('multiStream.deactivate.reconnect_failed', { error: String(err) })
    }
  }

  logger.info('multiStream.deactivate')
}

// Test helpers — not part of the public module contract.
export const __resetMultiStreamServiceForTests = (): void => {
  activeClient = null
  lastEventSubArgs = null
  inFlight = null
}
