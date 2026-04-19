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

export const StreamSelector = ({
  gameId,
  currentLogin,
  onConfirm,
  onCancel,
}: StreamSelectorProps) => {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  const availableStreams = loadState.status === 'ready' ? loadState.streams : []

  const picks: StreamPick[] = useMemo(
    () =>
      availableStreams
        .filter((s) => selected.has(s.user_login))
        .map(streamToPick),
    [availableStreams, selected],
  )

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

        {loadState.status === 'ready' && availableStreams.length === 0 && (
          <p className="py-6 text-sm text-text-muted">
            no other streams live in this category right now
          </p>
        )}

        {loadState.status === 'ready' && availableStreams.length > 0 && (
          <ul className="flex flex-col gap-2">
            {availableStreams.map((s) => {
              const checked = selected.has(s.user_login)
              const disabled = !checked && selected.size >= MAX_PICKS
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
                      <span className="ml-2 text-text-muted">
                        {s.viewer_count.toLocaleString('en-US')} viewers
                      </span>
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
