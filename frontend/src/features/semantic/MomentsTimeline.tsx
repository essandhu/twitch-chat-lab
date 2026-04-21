import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Tooltip } from '../../components/ui/Tooltip'
import { useSemanticStore } from '../../store/semanticStore'
import type { Moment, MomentKind } from '../../types/twitch'
import { ChatScrollContext } from '../chat/chatScrollContext'

const SVG = (path: ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
)

const ICONS: Record<MomentKind, JSX.Element> = {
  spike: SVG(<><polyline points="3 17 9 11 13 15 21 7" /><polyline points="14 7 21 7 21 14" /></>),
  'emote-storm': SVG(<><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M5.6 18.4l2.1-2.1M12 21v-3M18.4 18.4l-2.1-2.1M21 12h-3M18.4 5.6l-2.1 2.1" /><circle cx="12" cy="12" r="2" /></>),
  'qa-cluster': SVG(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3 2.5c-.7.3-1 1-1 1.5M12 16.5v.01" /></>),
  raid: SVG(<><path d="M14.5 14.5L21 21M3 10l7-7 7 7M6 14l4 4M10 18l4-4" /></>),
  'semantic-cluster': SVG(<><polygon points="12 2 4 8 12 14 20 8 12 2" /><polyline points="4 16 12 22 20 16" /><polyline points="4 12 12 18 20 12" /></>),
}

const COLOR_TOKEN: Record<MomentKind, string> = {
  spike: 'var(--warning)',
  raid: 'var(--danger)',
  'semantic-cluster': 'var(--accent)',
  'emote-storm': 'var(--accent-hover)',
  'qa-cluster': 'var(--accent-contrast)',
}

const MOMENT_SELECTED_EVT = 'moment-selected'

interface Props {
  moments?: Moment[]
}

export function MomentsTimeline({ moments: override }: Props = {}): JSX.Element | null {
  const storeMoments = useSemanticStore((s) => s.moments)
  const moments = override ?? storeMoments
  const scrollTo = useContext(ChatScrollContext)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const window = useMemo(() => {
    if (moments.length === 0) return null
    const starts = moments.map((m) => m.startedAt.getTime())
    const ends = moments.map((m) => m.endedAt.getTime())
    const min = Math.min(...starts)
    const max = Math.max(...ends)
    const span = Math.max(1, max - min)
    return { min, span }
  }, [moments])

  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<{ id: string }>).detail
      if (!detail) return
      setHighlighted(detail.id)
      setTimeout(() => setHighlighted((prev) => (prev === detail.id ? null : prev)), 1000)
    }
    const el = rootRef.current
    if (!el) return
    el.addEventListener(MOMENT_SELECTED_EVT, handler)
    return () => el.removeEventListener(MOMENT_SELECTED_EVT, handler)
  }, [])

  if (!window || moments.length === 0) return null

  const handleClick = (m: Moment) => {
    if (m.relatedMessageIds.length > 0) scrollTo(m.relatedMessageIds[0])
    rootRef.current?.dispatchEvent(
      new CustomEvent(MOMENT_SELECTED_EVT, { detail: { id: m.id }, bubbles: false }),
    )
  }

  return (
    <div
      ref={rootRef}
      data-testid="moments-timeline"
      className="relative mx-3 mb-2 mt-2 h-12 rounded-md border border-border/60 bg-surface/40"
    >
      {moments.map((m) => {
        const x = ((m.startedAt.getTime() - window.min) / window.span) * 100
        const isActive = highlighted === m.id
        return (
          <Tooltip key={m.id} content={<span className="font-mono text-[11px]">{m.label}</span>} side="top">
            <button
              type="button"
              data-testid="moment-tick"
              data-kind={m.kind}
              data-moment-id={m.id}
              onClick={() => handleClick(m)}
              aria-label={`${m.kind}: ${m.label}`}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border p-1.5 transition hover:scale-110 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              style={{
                left: `${Math.max(2, Math.min(98, x))}%`,
                borderColor: COLOR_TOKEN[m.kind],
                color: COLOR_TOKEN[m.kind],
                boxShadow: isActive ? `0 0 0 3px ${COLOR_TOKEN[m.kind]}` : undefined,
                backgroundColor: isActive ? 'rgb(var(--surface-hover))' : 'rgb(var(--bg))',
              }}
            >
              {ICONS[m.kind]}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
