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

export const startCompare = async (args: StartCompareArgs): Promise<void> => {
  if (useMultiStreamStore.getState().isActive) {
    logger.warn('multiStream.activate.already_active')
    return
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

  const store = useMultiStreamStore.getState()
  store.reset()
  // Seed the current stream as the first slice.
  store.addStream({
    login: args.session.broadcasterLogin,
    displayName: args.session.broadcasterDisplayName,
    broadcasterId: args.session.broadcasterId,
  })
  // Seed the picks.
  for (const pick of args.picks) {
    store.addStream({
      login: pick.login,
      displayName: pick.displayName,
      broadcasterId: pick.broadcasterId,
    })
  }

  const client = args.clientFactory
    ? args.clientFactory()
    : new ProxyClient({ proxyUrl: getProxyUrl() })

  try {
    const { sessionId } = await client.createSession({
      channels: [
        {
          login: args.session.broadcasterLogin,
          displayName: args.session.broadcasterDisplayName,
          broadcasterId: args.session.broadcasterId,
        },
        ...args.picks.map((p) => ({
          login: p.login,
          displayName: p.displayName,
          broadcasterId: p.broadcasterId,
        })),
      ],
      userId: args.authedUserId,
      accessToken: token,
    })

    await client.connect(sessionId)
    activeClient = client
    useMultiStreamStore.getState().setActive(true)
    logger.info('multiStream.activate', {
      channels: [args.session.broadcasterLogin, ...args.picks.map((p) => p.login)],
    })
  } catch (err) {
    logger.error('multiStream.activate.failed', { error: String(err) })
    useMultiStreamStore.getState().reset()
    activeClient = null
    // Try to restore single-stream EventSub.
    try {
      await eventSubManager.connect(lastEventSubArgs)
    } catch (reconnectErr) {
      logger.error('multiStream.activate.reconnect_failed', { error: String(reconnectErr) })
    }
    throw err
  }
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
}
