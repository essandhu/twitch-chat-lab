import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logger } from '../../lib/logger'
import { useChatStore } from '../../store/chatStore'
import { eventSubManager, twitchAuthService, twitchHelixClient } from './authServices'
import { PENDING_CHANNEL_KEY } from './ConnectForm'
import { buildSession, mergeBadges } from './sessionBootstrap'

type CallbackStatus =
  | { kind: 'pending' }
  | { kind: 'error'; message: string }
  | { kind: 'connected' }

export const AuthCallback = () => {
  const navigate = useNavigate()
  const [status, setStatus] = useState<CallbackStatus>({ kind: 'pending' })

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const result = twitchAuthService.handleCallback(window.location.hash)
      if (!result.success) {
        logger.warn('auth.callback.failed', { error: result.error })
        setStatus({ kind: 'error', message: 'Authentication failed. Please try again.' })
        return
      }

      const token = twitchAuthService.getToken()
      if (!token) {
        setStatus({ kind: 'error', message: 'Authentication failed. Please try again.' })
        return
      }

      twitchAuthService.startValidationPolling()

      const pendingChannel = sessionStorage.getItem(PENDING_CHANNEL_KEY)
      sessionStorage.removeItem(PENDING_CHANNEL_KEY)
      if (!pendingChannel) {
        setStatus({ kind: 'error', message: 'No channel selected. Please try again.' })
        return
      }

      try {
        const [authedUser, broadcaster] = await Promise.all([
          twitchHelixClient.getUser(),
          twitchHelixClient.getUser(pendingChannel),
        ])

        if (!authedUser) throw new Error('failed to resolve authed user')
        if (!broadcaster) throw new Error(`channel not found: ${pendingChannel}`)

        const [stream, globalBadges, channelBadges] = await Promise.all([
          twitchHelixClient.getStream(pendingChannel),
          twitchHelixClient.getGlobalBadges(),
          twitchHelixClient.getChannelBadges(broadcaster.id),
        ])

        if (cancelled) return

        const chat = useChatStore.getState()
        chat.resetForNewChannel()
        chat.setBadgeDefinitions(mergeBadges(globalBadges, channelBadges))
        chat.setSession(buildSession(broadcaster, stream))

        await eventSubManager.connect({
          broadcasterId: broadcaster.id,
          userId: authedUser.id,
          token,
        })

        if (cancelled) return
        setStatus({ kind: 'connected' })
        navigate('/', { replace: true })
      } catch (err) {
        logger.error('auth.callback.connect_failed', { error: String(err) })
        if (!cancelled) {
          setStatus({ kind: 'error', message: 'Could not connect to channel. Please try again.' })
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (status.kind === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 text-ink-100">
        <div className="grain relative flex flex-col gap-4 border border-ember-500/40 bg-ink-900/70 p-8 max-w-md">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-ember-500">
            Authentication Failed
          </div>
          <p className="text-ink-300">{status.message}</p>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="self-start border border-ember-500 px-4 py-2 font-mono text-xs uppercase tracking-[0.3em] text-ember-500 hover:bg-ember-500 hover:text-ink-950"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 text-ink-100">
      <div className="flex flex-col items-center gap-3 font-mono text-xs uppercase tracking-[0.3em] text-ember-500">
        <div className="h-px w-24 animate-pulse bg-ember-500" />
        <span>Handshaking with Twitch</span>
        <div className="h-px w-12 animate-pulse bg-ember-500/60" />
      </div>
    </div>
  )
}
