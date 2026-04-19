import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logger } from '../../lib/logger'
import { useChatStore } from '../../store/chatStore'
import { eventSubManager, twitchAuthService, twitchHelixClient } from './authServices'
import { PENDING_CHANNEL_KEY } from './ConnectForm'
import { buildSession, mergeBadges } from './sessionBootstrap'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'

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
      <div className="flex min-h-screen items-center justify-center bg-bg text-text p-6">
        <Card className="max-w-md w-full">
          <Card.Body className="flex flex-col gap-4 p-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-danger">
              Authentication Failed
            </div>
            <p className="text-sm text-text-muted">{status.message}</p>
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => navigate('/', { replace: true })}
            >
              Try again
            </Button>
          </Card.Body>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-text p-6">
      <Card className="max-w-md w-full">
        <Card.Body className="flex flex-col gap-4 p-8">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent">
            Handshaking with Twitch
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </Card.Body>
      </Card>
    </div>
  )
}
