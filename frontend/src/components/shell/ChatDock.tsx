import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ChatDockProps = {
  children: ReactNode
  className?: string
}

const WIDTH_KEY = 'tcl.chat-dock.width'
const COLLAPSED_KEY = 'tcl.chat-dock.collapsed'

const DEFAULT_WIDTH = 340
const MIN_WIDTH = 240
const MAX_WIDTH = 480
const COLLAPSED_WIDTH = 40

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n))

const readInitialWidth = (): number => {
  if (typeof localStorage === 'undefined') return DEFAULT_WIDTH
  const raw = localStorage.getItem(WIDTH_KEY) ?? ''
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed)) return DEFAULT_WIDTH
  if (parsed < MIN_WIDTH || parsed > MAX_WIDTH) return DEFAULT_WIDTH
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

export const ChatDock = ({ children, className }: ChatDockProps) => {
  const [width, setWidth] = useState<number>(() => readInitialWidth())
  const [collapsed, setCollapsed] = useState<boolean>(() => readInitialCollapsed())
  const widthRef = useRef(width)
  widthRef.current = width

  const { onPointerDown } = useResizeDrag(widthRef, setWidth)

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
          className="text-text-muted hover:text-text px-1 py-2 text-sm"
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
      {children}
    </div>
  )
}
