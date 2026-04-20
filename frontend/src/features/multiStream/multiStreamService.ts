import { logger } from '../../lib/logger'
import { eventSubManager, twitchAuthService, twitchHelixClient } from '../auth/authServices'
import { useChatStore } from '../../store/chatStore'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import type { StreamSession } from '../../types/twitch'
import { ProxyClient } from './ProxyClient'
import type { StreamPick } from './StreamSelector'

// Fire-and-forget: look up profile images for freshly-added slices so
// TrackedRow / chat column headers can swap the letter-fallback avatars for
// real channel pictures. We don't block startCompare on these — the UI
// renders the fallback while the fetch is in flight.
const hydrateProfileImages = (logins: string[]): void => {
  for (const login of logins) {
    twitchHelixClient
      .getUser(login)
      .then((user) => {
        if (!user?.profile_image_url) return
        const store = useMultiStreamStore.getState()
        const slice = store.streams[login]
        if (!slice) return
        useMultiStreamStore.setState({
          streams: {
            ...store.streams,
            [login]: { ...slice, profileImageUrl: user.profile_image_url },
          },
        })
      })
      .catch((err) =>
        logger.warn('multiStream.profile_image.fetch_failed', { login, error: String(err) }),
      )
  }
}

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
// Last channel list we told the proxy about — lets updateCompare compute a
// minimal diff instead of tearing down and recreating the session. Kept in
// step with startCompare / successful updateCompare / stopCompare.
let activeChannels: ChannelListEntry[] = []
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
    profileImageUrl: session.profileImageUrl,
  })
  for (const pick of picks) {
    store.addStream({
      login: pick.login,
      displayName: pick.displayName,
      broadcasterId: pick.broadcasterId,
    })
  }
  // Current session already carries its image from AuthCallback; picks need
  // a separate /users lookup. Fire-and-forget — the UI shows the letter
  // fallback while the fetch is in flight.
  hydrateProfileImages(picks.map((p) => p.login))
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

export interface ChannelListEntry {
  login: string
  displayName: string
  broadcasterId: string
}

export interface ChannelDiff {
  add: ChannelListEntry[]
  remove: string[]
}

/**
 * Diff two channel lists so PATCH /session can describe the change as
 * disjoint add/remove sets. Login is the identity — order is irrelevant.
 */
export const diffChannels = (prev: ChannelListEntry[], next: ChannelListEntry[]): ChannelDiff => {
  const prevLogins = new Set(prev.map((c) => c.login))
  const nextLogins = new Set(next.map((c) => c.login))
  const add = next.filter((c) => !prevLogins.has(c.login))
  const remove = prev.map((c) => c.login).filter((login) => !nextLogins.has(login))
  return { add, remove }
}

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
    const channels = buildChannelList({ session: args.session, picks: args.picks })
    try {
      const { sessionId } = await client.createSession({
        channels,
        userId: args.authedUserId,
        accessToken: token,
      })

      await client.connect(sessionId)
      activeClient = client
      activeChannels = channels
      logger.info('multiStream.activate', {
        channels: [args.session.broadcasterLogin, ...args.picks.map((p) => p.login)],
      })
    } catch (err) {
      logger.error('multiStream.activate.failed', { error: String(err) })
      useMultiStreamStore.getState().reset()
      activeClient = null
      activeChannels = []
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
 *
 * Fast path (PATCH): if the previous client is still connected, we diff
 * the old vs new channel list and issue PATCH /session with the
 * add/remove sets. The proxy reuses the existing session — the WebSocket
 * stays open, overlapping channels' pools are never torn down, and only
 * the net-new channels open upstream EventSub transports. This avoids
 * the transport-cap churn the full-recreate path would cause for a
 * rapid swap.
 *
 * Slow path (recreate): PATCH failure (or missing previous client) falls
 * through to the classic disconnect-then-createSession flow so the user
 * always lands in a coherent state, albeit with a few hundred ms of
 * reconnect latency.
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

  const nextChannels = buildChannelList({ session: args.session, picks: args.picks })

  const run = async (): Promise<void> => {
    // --- Fast path: PATCH the live session in place.
    const currentClient = activeClient
    const currentSessionId = currentClient?.getSessionId() ?? null
    if (currentClient && currentSessionId && activeChannels.length > 0) {
      const diff = diffChannels(activeChannels, nextChannels)
      if (diff.add.length === 0 && diff.remove.length === 0) {
        // No channel change — the store already reflects reality. Skip the
        // reset-and-reseed dance; it would wipe cached messages and flip
        // every column back to "connecting" for nothing.
        useMultiStreamStore.getState().setActive(true)
        activeChannels = nextChannels
        logger.info('multiStream.update.noop')
        return
      }
      try {
        await currentClient.patchSession({
          sessionId: currentSessionId,
          add: diff.add,
          remove: diff.remove,
          userId: args.authedUserId,
          accessToken: token,
        })
        // Incremental store mutation: overlapping slices KEEP their cached
        // messages, connectionState, annotations, etc. Only channels in
        // diff.remove disappear and channels in diff.add arrive in the
        // connecting state. Without this, the PATCH fast path gives the
        // user the same "all columns reload" UX as a full recreate.
        const store = useMultiStreamStore.getState()
        for (const login of diff.remove) {
          store.removeStream(login)
        }
        for (const entry of diff.add) {
          store.addStream({
            login: entry.login,
            displayName: entry.displayName,
            broadcasterId: entry.broadcasterId,
          })
        }
        store.setActive(true)
        // Hydrate profile images only for net-new picks — the overlapping
        // channels already have theirs (or have the letter fallback in
        // flight). Session's own avatar was set at startCompare time.
        hydrateProfileImages(
          diff.add
            .map((c) => c.login)
            .filter((l) => l !== args.session.broadcasterLogin),
        )
        activeChannels = nextChannels
        logger.info('multiStream.update.patched', {
          added: diff.add.map((c) => c.login),
          removed: diff.remove,
        })
        return
      } catch (err) {
        logger.warn('multiStream.update.patch_failed_fallback', { error: String(err) })
        // Fall through to the recreate path below.
      }
    }

    // --- Slow path: full recreate.
    const previousClient = activeClient
    activeClient = null
    activeChannels = []

    const client = args.clientFactory
      ? args.clientFactory()
      : new ProxyClient({ proxyUrl: getProxyUrl() })

    if (previousClient) {
      try {
        await previousClient.disconnect()
      } catch (err) {
        logger.warn('multiStream.update.disconnect_error', { error: String(err) })
      }
    }

    seedStore({ session: args.session, picks: args.picks })
    useMultiStreamStore.getState().setActive(true)

    try {
      const { sessionId } = await client.createSession({
        channels: nextChannels,
        userId: args.authedUserId,
        accessToken: token,
      })

      await client.connect(sessionId)
      activeClient = client
      activeChannels = nextChannels
      logger.info('multiStream.update', {
        channels: [args.session.broadcasterLogin, ...args.picks.map((p) => p.login)],
      })
    } catch (err) {
      logger.error('multiStream.update.failed', { error: String(err) })
      useMultiStreamStore.getState().reset()
      activeClient = null
      activeChannels = []
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
  activeChannels = []

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
  activeChannels = []
  inFlight = null
}
