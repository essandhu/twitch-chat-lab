import { useEffect, useState } from 'react'
import { useChatStore } from '../store/chatStore'
import { twitchHelixClient } from '../features/auth/authServices'
import { logger } from '../lib/logger'
import { StreamSelector, type StreamPick } from '../features/multiStream/StreamSelector'
import { startCompare } from '../features/multiStream/multiStreamService'
import { Button } from './ui/Button'

export function StreamHeader(): JSX.Element | null {
  const session = useChatStore((s) => s.session)
  const setSession = useChatStore((s) => s.setSession)
  const broadcasterLogin = session?.broadcasterLogin ?? null
  const [selectorOpen, setSelectorOpen] = useState(false)

  useEffect(() => {
    if (broadcasterLogin === null) return

    const poll = (): void => {
      twitchHelixClient
        .getStream(broadcasterLogin)
        .then((stream) => {
          const current = useChatStore.getState().session
          if (current === null) return
          if (stream) {
            setSession({
              ...current,
              streamTitle: stream.title,
              gameName: stream.game_name,
              gameId: stream.game_id,
              viewerCount: stream.viewer_count,
            })
          } else {
            setSession({
              ...current,
              streamTitle: '',
              gameName: '',
              gameId: '',
              viewerCount: 0,
            })
          }
        })
        .catch((err) => logger.warn('stream.poll.error', { error: String(err) }))
    }

    const id = setInterval(poll, 60_000)
    return () => clearInterval(id)
  }, [broadcasterLogin, setSession])

  if (session === null) return null

  const isOffline = session.viewerCount === 0 && session.gameName === ''
  // Disable when there's no category to query — can't find peer streams otherwise.
  const canCompare = session.gameId.length > 0
  const compareTitle = canCompare
    ? 'Compare this stream with up to 2 others in the same category'
    : 'Connect to a stream first'

  const handleConfirm = async (picks: StreamPick[]): Promise<void> => {
    setSelectorOpen(false)
    try {
      // authedUserId is not on the StreamSession today (Phase 2 didn't need it);
      // resolve it via /users on demand. For multi-stream we need user_id for
      // the EventSub subscriptions on the current channel.
      const me = await twitchHelixClient.getUser()
      if (!me) throw new Error('failed_to_resolve_user')
      await startCompare({
        session,
        authedUserId: me.id,
        picks,
      })
    } catch (err) {
      logger.error('multiStream.start.error', { error: String(err) })
    }
  }

  return (
    <header className="flex items-baseline gap-6 border-b border-border bg-surface px-6 py-4">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-lg text-text line-clamp-1">
          {session.streamTitle || '—'}
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
          {session.gameName || 'uncategorized'}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canCompare}
          title={compareTitle}
          onClick={() => setSelectorOpen(true)}
          className="font-mono uppercase tracking-[0.22em]"
        >
          Compare streams
        </Button>
        {isOffline ? (
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
            offline
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="relative inline-block h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
              <span className="absolute inset-0 rounded-full bg-success" />
            </span>
            <span className="font-mono text-sm text-text">
              {session.viewerCount.toLocaleString('en-US')} viewers
            </span>
          </span>
        )}
      </div>
      {selectorOpen && session.gameId && (
        <StreamSelector
          gameId={session.gameId}
          currentLogin={session.broadcasterLogin}
          onConfirm={(picks) => {
            // Fire-and-forget — the service logs its own errors.
            void handleConfirm(picks)
          }}
          onCancel={() => setSelectorOpen(false)}
        />
      )}
    </header>
  )
}
