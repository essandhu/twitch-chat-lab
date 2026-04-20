import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ChatDockProps = {
  children: ReactNode
  className?: string
  /**
   * Fallback width (in px) when no valid value is persisted in localStorage.
   * Clamped into [MIN_WIDTH, MAX_WIDTH]. Defaults to 340.
   */
  defaultWidth?: number
  /**
   * External auto-collapse signal (e.g. multi-stream mode takes over the main
   * pane and makes the dock's chat redundant). Transitions to true collapse
   * the dock; the persisted collapse preference in localStorage is never
   * written from this prop, so exiting leaves the dock in whatever state the
   * user last drove it to.
   */
  forceCollapsed?: boolean
}

const WIDTH_KEY = 'tcl.chat-dock.width'
const COLLAPSED_KEY = 'tcl.chat-dock.collapsed'

const DEFAULT_WIDTH = 340
const MIN_WIDTH = 240
const MAX_WIDTH = 480
const COLLAPSED_WIDTH = 40

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n))

const readInitialWidth = (fallback: number): number => {
  const clampedFallback = clamp(fallback, MIN_WIDTH, MAX_WIDTH)
  if (typeof localStorage === 'undefined') return clampedFallback
  const raw = localStorage.getItem(WIDTH_KEY) ?? ''
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed)) return clampedFallback
  if (parsed < MIN_WIDTH || parsed > MAX_WIDTH) return clampedFallback
  return parsed
}

const readInitialCollapsed = (): boolean => {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(COLLAPSED_KEY) === 'true'
}

const isEditableTarget = (el: Element | null): boolean => {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

type UseResizeDragResult = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
}

const useResizeDrag = (
  widthRef: React.MutableRefObject<number>,
  setWidth: (w: number) => void,
): UseResizeDragResult => {
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      draggingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = widthRef.current
      if (typeof document !== 'undefined') {
        document.body.classList.add('select-none')
      }

      const handleMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return
        const delta = ev.clientX - startXRef.current
        const next = clamp(startWidthRef.current - delta, MIN_WIDTH, MAX_WIDTH)
        setWidth(next)
      }
      const handleUp = () => {
        if (!draggingRef.current) return
        draggingRef.current = false
        if (typeof document !== 'undefined') {
          document.body.classList.remove('select-none')
        }
        try {
          localStorage.setItem(WIDTH_KEY, String(widthRef.current))
        } catch {
          // ignore
        }
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [widthRef, setWidth],
  )

  return { onPointerDown }
}

export const ChatDock = ({
  children,
  className,
  defaultWidth = DEFAULT_WIDTH,
  forceCollapsed = false,
}: ChatDockProps) => {
  const [width, setWidth] = useState<number>(() => readInitialWidth(defaultWidth))
  const [collapsed, setCollapsed] = useState<boolean>(
    () => forceCollapsed || readInitialCollapsed(),
  )
  const widthRef = useRef(width)
  widthRef.current = width

  const { onPointerDown } = useResizeDrag(widthRef, setWidth)

  // Auto-collapse on the false→true edge of forceCollapsed. We deliberately
  // do NOT restore on the true→false edge — if the user manually expanded
  // the dock during multi-stream they'd expect that to stick.
  const prevForceRef = useRef(forceCollapsed)
  useEffect(() => {
    if (forceCollapsed && !prevForceRef.current) setCollapsed(true)
    prevForceRef.current = forceCollapsed
  }, [forceCollapsed])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_KEY, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  useEffect(() => {
    // Ctrl+Shift+C only — reject Cmd/meta to avoid macOS copy + browser devtools conflicts.
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() !== 'c') return
      if (isEditableTarget(document.activeElement)) return
      e.preventDefault()
      toggleCollapsed()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleCollapsed])

  if (collapsed) {
    return (
      <div
        data-shell-section="chat-dock"
        className={cn(
          'bg-surface border-l border-border h-full flex flex-col items-center justify-start pt-4',
          className,
        )}
        style={{ width: COLLAPSED_WIDTH }}
      >
        <button
          type="button"
          aria-label="Expand chat"
          onClick={toggleCollapsed}
          className="text-text-muted hover:text-text px-1 py-2 text-sm rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ writingMode: 'vertical-rl' }}
        >
          Chat
        </button>
      </div>
    )
  }

  return (
    <div
      data-shell-section="chat-dock"
      className={cn(
        'bg-surface border-l border-border h-full flex flex-col relative transition-[width] duration-150 ease-out',
        className,
      )}
      style={{ width }}
    >
      <div
        data-testid="chat-dock-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize chat dock"
        onPointerDown={onPointerDown}
        className="absolute left-0 top-0 h-full w-1 cursor-col-resize before:absolute before:inset-y-0 before:-left-1 before:w-2 before:content-['']"
      />
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border pl-3 pr-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
          Chat
        </span>
        <button
          type="button"
          aria-label="Collapse chat (Ctrl+Shift+C)"
          title="Collapse chat (Ctrl+Shift+C)"
          onClick={toggleCollapsed}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
