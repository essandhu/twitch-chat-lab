import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { logger } from '../../lib/logger'
import { twitchHelixClient } from '../auth/authServices'
import type { HelixStream } from '../../types/twitch'

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
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null)

  const load = useCallback(async () => {
    setLoadState({ status: 'loading' })
    try {
      const streams = await twitchHelixClient.getStreamsByCategory(gameId, 5)
      const filtered = streams.filter((s) => s.user_login.toLowerCase() !== currentLogin.toLowerCase())
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

  // ESC → cancel. Focus trap between cancel/confirm buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key === 'Tab') {
        const focusables: HTMLElement[] = []
        if (cancelBtnRef.current) focusables.push(cancelBtnRef.current)
        if (confirmBtnRef.current) focusables.push(confirmBtnRef.current)
        if (focusables.length === 0) return
        const first = focusables[0]!
        const last = focusables[focusables.length - 1]!
        const active = document.activeElement as HTMLElement | null
        if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    // Autofocus cancel button on mount (won't immediately confirm).
    cancelBtnRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [onCancel])

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stream-selector-title"
        className="relative flex w-[min(32rem,90vw)] flex-col gap-5 border border-ink-700 bg-ink-900 p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
      >
        <div className="flex items-center gap-3 text-ember-500 font-mono text-xs tracking-[0.3em]">
          <span className="h-px flex-1 bg-ember-500/40" />
          <span id="stream-selector-title">COMPARE STREAMS</span>
          <span className="h-px flex-1 bg-ember-500/40" />
        </div>

        {loadState.status === 'loading' && (
          <div className="flex items-center gap-3 py-8 font-mono text-xs text-ink-300">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-spin border-2 border-ember-500 border-t-transparent"
            />
            <span>finding streams in same category&hellip;</span>
          </div>
        )}

        {loadState.status === 'error' && (
          <div className="flex flex-col gap-3 py-4">
            <p className="font-mono text-xs text-ink-300">
              Failed to load streams: {loadState.message}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="self-start border border-ember-500 bg-ember-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-ember-500 hover:bg-ember-500 hover:text-ink-950"
            >
              Retry
            </button>
          </div>
        )}

        {loadState.status === 'ready' && availableStreams.length === 0 && (
          <p className="py-6 font-mono text-xs text-ink-300">
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
                    className={`flex cursor-pointer items-center gap-3 border bg-ink-950 px-3 py-2 font-mono text-xs ${
                      checked
                        ? 'border-ember-500 text-ink-100'
                        : 'border-ink-700 text-ink-300 hover:border-ember-500/60'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-ember-500"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleSelection(s.user_login)}
                      aria-label={`Select ${s.user_name}`}
                    />
                    <span className="flex-1">
                      <span className="font-display text-sm text-ink-100">{s.user_name}</span>
                      <span className="ml-2 text-ink-500">
                        {s.viewer_count.toLocaleString('en-US')} viewers
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            ref={cancelBtnRef}
            type="button"
            onClick={onCancel}
            className="border border-ink-700 bg-ink-900 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-300 hover:border-ink-500 hover:text-ink-100"
          >
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={handleCompare}
            disabled={!canCompare}
            className={`px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] ${
              canCompare
                ? 'border border-ember-500 bg-ember-500/10 text-ember-500 hover:bg-ember-500 hover:text-ink-950'
                : 'border border-ink-700 text-ink-500 cursor-not-allowed'
            }`}
          >
            Compare
          </button>
        </div>
      </div>
    </div>
  )
}
