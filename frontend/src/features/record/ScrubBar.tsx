import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sessionReplayer } from '../auth/authServices'
import { useSemanticStore } from '../../store/semanticStore'
import type { MomentKind, ReplaySpeed } from '../../types/twitch'
import { isReplayMode } from './replayBoot'

const MOMENT_COLOR: Record<MomentKind, string> = {
  spike: 'var(--warning)',
  raid: 'var(--danger)',
  'semantic-cluster': 'var(--accent)',
  'emote-storm': 'var(--accent-hover)',
  'qa-cluster': 'var(--accent-contrast)',
}

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 5]

const formatTime = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export function ScrubBar(): JSX.Element | null {
  const active = isReplayMode()
  const moments = useSemanticStore((s) => s.moments)
  const [position, setPosition] = useState<number>(() => sessionReplayer.getPosition())
  const [playing, setPlaying] = useState<boolean>(() => sessionReplayer.isPlaying())
  const [speed, setSpeed] = useState<ReplaySpeed>(1)
  const [dragX, setDragX] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const duration = sessionReplayer.getDuration()
  const firstT = sessionReplayer.getFirstT()

  useEffect(() => {
    if (!active) return
    return sessionReplayer.onPositionChange((ms) => setPosition(ms))
  }, [active])

  const fracFromX = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragX(e.clientX)
      const move = (ev: PointerEvent) => setDragX(ev.clientX)
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDragX(null)
        if (duration > 0) sessionReplayer.seekTo(fracFromX(ev.clientX) * duration)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [duration, fracFromX],
  )

  const fraction = useMemo(() => {
    if (dragX !== null) return fracFromX(dragX)
    return duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0
  }, [dragX, position, duration, fracFromX])

  const displayedMs = dragX !== null ? fraction * duration : position

  const onPlay = () => { sessionReplayer.play(); setPlaying(true) }
  const onPause = () => { sessionReplayer.pause(); setPlaying(false) }
  const onSpeed = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = Number(e.target.value) as ReplaySpeed
    setSpeed(next)
    sessionReplayer.setSpeed(next)
  }

  if (!active) return null

  return (
    <div
      data-testid="scrub-bar"
      className="flex items-center gap-3 px-3 py-2 border-b border-border bg-surface/60"
    >
      {playing ? (
        <button type="button" data-testid="scrub-pause" onClick={onPause} aria-label="Pause replay"
          className="h-8 px-3 rounded-md border border-border text-sm hover:bg-surface-hover">Pause</button>
      ) : (
        <button type="button" data-testid="scrub-play" onClick={onPlay} aria-label="Play replay"
          className="h-8 px-3 rounded-md border border-border text-sm hover:bg-surface-hover">Play</button>
      )}

      <div className="relative flex-1 h-8 select-none" onPointerDown={onPointerDown}>
        <div ref={trackRef}
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full"
          style={{ backgroundColor: 'var(--border)' }} />
        <div className="hidden md:block absolute inset-0 pointer-events-none">
          {duration > 0 && moments.map((m) => {
            const pct = Math.max(0, Math.min(100, ((m.startedAt.getTime() - firstT) / duration) * 100))
            return (
              <button key={m.id} type="button"
                data-testid="scrub-moment-tick" data-kind={m.kind}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => {
                  ev.stopPropagation()
                  sessionReplayer.seekTo(m.startedAt.getTime() - firstT)
                }}
                aria-label={`Jump to ${m.kind} moment`}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 pointer-events-auto"
                style={{ left: `${pct}%`, backgroundColor: MOMENT_COLOR[m.kind] }} />
            )
          })}
        </div>
        <div data-testid="scrub-thumb" role="slider"
          aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(displayedMs)}
          aria-label="Replay position"
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-4 w-4 rounded-full border"
          style={{ left: `${fraction * 100}%`, backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' }} />
      </div>

      <span className="font-mono text-xs tabular-nums text-text-muted min-w-[3.5rem] text-right">
        {formatTime(displayedMs)}
      </span>

      <select data-testid="scrub-speed" value={speed} onChange={onSpeed} aria-label="Replay speed"
        className="h-8 px-2 rounded-md border border-border bg-surface text-sm">
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
    </div>
  )
}
