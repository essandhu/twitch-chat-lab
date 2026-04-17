import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import { twitchHelixClient } from '../features/auth/authServices'
import { logger } from '../lib/logger'

export function StreamHeader(): JSX.Element | null {
  const session = useChatStore((s) => s.session)
  const setSession = useChatStore((s) => s.setSession)
  const broadcasterLogin = session?.broadcasterLogin ?? null

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

  return (
    <header className="flex items-baseline gap-6 border-b border-ink-800 bg-ink-900/40 px-6 py-4">
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-lg text-ink-100 line-clamp-1">
          {session.streamTitle || '—'}
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500">
          {session.gameName || 'uncategorized'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* TODO(phase-4): "Compare streams" entry point */}
        {isOffline ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-500">
            offline
          </span>
        ) : (
          <>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ember-500" />
            <span className="font-mono text-sm text-ink-100">
              {session.viewerCount.toLocaleString('en-US')} viewers
            </span>
          </>
        )}
      </div>
    </header>
  )
}
