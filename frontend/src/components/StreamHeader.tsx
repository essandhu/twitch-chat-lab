import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '../store/chatStore'
import { useMultiStreamStore } from '../store/multiStreamStore'
import { twitchHelixClient } from '../features/auth/authServices'
import { logger } from '../lib/logger'
import { StreamSelector, type StreamPick } from '../features/multiStream/StreamSelector'
import { startCompare, updateCompare } from '../features/multiStream/multiStreamService'
import { Avatar } from './ui/Avatar'
import { Button } from './ui/Button'
import { RaidRiskChip } from '../features/intelligence/RaidRiskChip'
import { RaidRiskTuner } from '../features/intelligence/RaidRiskTuner'
import { useSafeMode } from '../hooks/useSafeMode'
import { censorText } from '../lib/profanityFilter'

export function StreamHeader(): JSX.Element | null {
  const session = useChatStore((s) => s.session)
  const setSession = useChatStore((s) => s.setSession)
  const broadcasterLogin = session?.broadcasterLogin ?? null
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isMultiActive = useMultiStreamStore((s) => s.isActive)
  const multiStreamOrder = useMultiStreamStore((s) => s.order)
  const multiStreams = useMultiStreamStore((s) => s.streams)
  const { safeMode } = useSafeMode()

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

  // The list of peers already in the active comparison, excluding the current
  // broadcaster (who is always slice 0 and isn't a "pick").
  const existingPicks: StreamPick[] = useMemo(() => {
    if (!isMultiActive || !session) return []
    const currentLogin = session.broadcasterLogin.toLowerCase()
    return multiStreamOrder
      .filter((login) => login.toLowerCase() !== currentLogin)
      .map((login) => multiStreams[login])
      .filter((slice): slice is NonNullable<typeof slice> => Boolean(slice))
      .map((slice) => ({
        login: slice.login,
        displayName: slice.displayName,
        broadcasterId: slice.broadcasterId,
      }))
  }, [isMultiActive, multiStreamOrder, multiStreams, session])

  if (session === null) return null

  const isOffline = session.viewerCount === 0 && session.gameName === ''
  // Disable when there's no category to query — can't find peer streams otherwise.
  const canCompare = session.gameId.length > 0
  const compareLabel = isMultiActive ? 'Change streams' : 'Compare streams'
  const compareTitle = canCompare
    ? isMultiActive
      ? 'Change which streams are compared'
      : 'Compare this stream with up to 2 others in the same category'
    : 'Connect to a stream first'

  const handleConfirm = async (picks: StreamPick[]): Promise<void> => {
    setSelectorOpen(false)
    setErrorMessage(null)
    try {
      const me = await twitchHelixClient.getUser()
      if (!me) throw new Error('failed_to_resolve_user')
      if (isMultiActive) {
        await updateCompare({
          session,
          authedUserId: me.id,
          picks,
        })
      } else {
        await startCompare({
          session,
          authedUserId: me.id,
          picks,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('multiStream.start.error', { error: message })
      // in_flight isn't a user-facing error; ignore it so a second click while
      // the first is mid-connection stays silent.
      if (message !== 'in_flight') {
        setErrorMessage(`Failed to update comparison: ${message}`)
      }
    }
  }

  const broadcasterInitial = (
    session.broadcasterDisplayName || session.broadcasterLogin
  )
    .charAt(0)
    .toUpperCase()

  return (
    <header className="flex flex-col gap-2 border-b border-border bg-surface px-6 py-4">
      <div className="flex items-center gap-4">
        <Avatar.Root className="h-12 w-12 shrink-0">
          {session.profileImageUrl ? (
            <Avatar.Image
              src={session.profileImageUrl}
              alt={session.broadcasterDisplayName || session.broadcasterLogin}
            />
          ) : null}
          <Avatar.Fallback
            className="text-base"
            delayMs={session.profileImageUrl ? 400 : 0}
          >
            {broadcasterInitial}
          </Avatar.Fallback>
        </Avatar.Root>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-lg text-text line-clamp-1">
              {session.broadcasterDisplayName || session.broadcasterLogin}
            </h1>
            <span className="font-mono text-xs text-text-muted">
              @{session.broadcasterLogin}
            </span>
          </div>
          <p className="truncate font-mono text-[11px] text-text-muted">
            {session.streamTitle ? censorText(session.streamTitle, safeMode) : '—'}
            <span className="mx-2 text-text-muted/50">·</span>
            <span className="uppercase tracking-[0.2em]">
              {session.gameName || 'uncategorized'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RaidRiskChip />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canCompare}
            title={compareTitle}
            onClick={() => setSelectorOpen(true)}
            className="font-mono uppercase tracking-[0.22em]"
          >
            {compareLabel}
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
      </div>
      <RaidRiskTuner />
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded border border-danger/60 bg-danger/10 px-3 py-1.5 text-xs text-danger"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setErrorMessage(null)}
            className="font-mono text-[11px] uppercase tracking-[0.2em] hover:text-text"
          >
            dismiss
          </button>
        </div>
      )}
      {selectorOpen && session.gameId && (
        <StreamSelector
          gameId={session.gameId}
          currentLogin={session.broadcasterLogin}
          initialSelected={existingPicks}
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
