import { useCallback, useEffect, useMemo, useState } from 'react'
import { logger } from '../../lib/logger'
import { twitchHelixClient } from '../auth/authServices'
import type { HelixStream } from '../../types/twitch'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'

export interface StreamPick {
  login: string
  displayName: string
  broadcasterId: string
}

interface StreamSelectorProps {
  gameId: string
  currentLogin: string
  onConfirm: (picks: StreamPick[]) => void
  onCancel: () => void
  /**
   * Channels already in an active comparison. Rendered pre-checked at the top
   * of the list, even if they don't appear in the Helix category results
   * (e.g., the user's peers went offline since the compare started).
   */
  initialSelected?: StreamPick[]
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; streams: HelixStream[] }

const MAX_PICKS = 2

const streamToPick = (s: HelixStream): StreamPick => ({
  broadcasterId: s.user_id,
  login: s.user_login,
  displayName: s.user_name,
})

// Synthesize a minimal HelixStream-shaped row for a pre-selected pick that
// isn't in the Helix results. viewer_count 0 tells the renderer to hide the
// viewer tag; we don't have a live number and we shouldn't invent one.
const pickToSyntheticStream = (p: StreamPick): HelixStream => ({
  id: `preselected_${p.login}`,
  user_id: p.broadcasterId,
  user_login: p.login,
  user_name: p.displayName,
  title: '',
  game_id: '',
  game_name: '',
  viewer_count: 0,
  started_at: '',
  thumbnail_url: '',
})

export const StreamSelector = ({
  gameId,
  currentLogin,
  onConfirm,
  onCancel,
  initialSelected = [],
}: StreamSelectorProps) => {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelected.map((p) => p.login)),
  )

  const load = useCallback(async () => {
    setLoadState({ status: 'loading' })
    try {
      const streams = await twitchHelixClient.getStreamsByCategory(gameId, 5)
      const filtered = streams.filter(
        (s) => s.user_login.toLowerCase() !== currentLogin.toLowerCase(),
      )
      setLoadState({ status: 'ready', streams: filtered })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      logger.warn('stream_selector.load_failed', { error: message })
      setLoadState({ status: 'error', message })
    }
  }, [gameId, currentLogin])

  useEffect(() => {
    void load()
  }, [load])

  const toggleSelection = (login: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(login)) {
        next.delete(login)
        return next
      }
      if (next.size >= MAX_PICKS) return prev
      next.add(login)
      return next
    })
  }

  // Merge Helix results with any pre-selected channels missing from them, so
  // the dropdown accurately reflects the user's current comparison even for
  // peers who have gone offline since compare started.
  const displayedStreams = useMemo((): HelixStream[] => {
    const helix = loadState.status === 'ready' ? loadState.streams : []
    const helixLogins = new Set(helix.map((s) => s.user_login))
    const missingPreselected = initialSelected
      .filter((p) => !helixLogins.has(p.login))
      .map(pickToSyntheticStream)
    // Pre-selected rows render first so they're not buried below category
    // peers and the user can see them without scrolling.
    return [...missingPreselected, ...helix]
  }, [loadState, initialSelected])

  const picks: StreamPick[] = useMemo(() => {
    // Resolve picks from the displayed list so broadcaster_id / display_name
    // round-trip through (even for rows that only exist because they were
    // pre-selected).
    return displayedStreams
      .filter((s) => selected.has(s.user_login))
      .map(streamToPick)
  }, [displayedStreams, selected])

  const canCompare = picks.length >= 1 && picks.length <= MAX_PICKS

  const handleCompare = () => {
    if (!canCompare) return
    onConfirm(picks)
  }

  // Parent mounts conditionally, so we're always open while mounted. Closing
  // (ESC, overlay click, X button) routes through onCancel via onOpenChange.
  const handleOpenChange = (open: boolean) => {
    if (!open) onCancel()
  }

  return (
    <Dialog.Root open onOpenChange={handleOpenChange}>
      <Dialog.Content>
        <Dialog.Title>Select streams to compare</Dialog.Title>
        <Dialog.Description>
          Pick up to {MAX_PICKS} other live streams in the same category.
        </Dialog.Description>

        {loadState.status === 'loading' && (
          <div className="flex items-center gap-3 py-8 text-sm text-text-muted">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            <span>finding streams in same category&hellip;</span>
          </div>
        )}

        {loadState.status === 'error' && (
          <div className="flex flex-col gap-3 py-4">
            <p className="text-sm text-text-muted">
              Failed to load streams: {loadState.message}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => void load()}
            >
              Retry
            </Button>
          </div>
        )}

        {loadState.status === 'ready' && displayedStreams.length === 0 && (
          <p className="py-6 text-sm text-text-muted">
            no other streams live in this category right now
          </p>
        )}

        {loadState.status === 'ready' && displayedStreams.length > 0 && (
          <ul className="flex flex-col gap-2">
            {displayedStreams.map((s) => {
              const checked = selected.has(s.user_login)
              const disabled = !checked && selected.size >= MAX_PICKS
              const isPreselectedOffline =
                s.id.startsWith('preselected_') && s.viewer_count === 0
              return (
                <li key={s.user_login}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-md border bg-surface px-3 py-2 text-sm ${
                      checked
                        ? 'border-accent text-text'
                        : 'border-border text-text-muted hover:border-accent/60'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleSelection(s.user_login)}
                      aria-label={`Select ${s.user_name}`}
                    />
                    <span className="flex-1">
                      <span className="font-semibold text-text">{s.user_name}</span>
                      {isPreselectedOffline ? (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                          current selection
                        </span>
                      ) : (
                        <span className="ml-2 text-text-muted">
                          {s.viewer_count.toLocaleString('en-US')} viewers
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleCompare} disabled={!canCompare}>
            Compare
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
