import { useEffect, useState, type ReactNode } from 'react'
import { ThemeProvider } from '../ThemeProvider'
import { TooltipProvider } from '../ui/Tooltip'
import { ToastProvider } from '../ui/Toast'

export type AppShellProps = {
  top: ReactNode
  rail: ReactNode
  main: ReactNode
  dock: ReactNode
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const readReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export const AppShell = ({ top, rail, main, dock }: AppShellProps) => {
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => readReducedMotion())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(REDUCED_MOTION_QUERY)
    setReducedMotion(mql.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return (
    <ThemeProvider>
      <TooltipProvider>
        <ToastProvider>
          <div
            data-app-shell
            data-reduced-motion={reducedMotion ? 'true' : 'false'}
            className="grid h-full w-full"
            style={{
              gridTemplateRows: '56px 1fr',
              gridTemplateColumns: 'auto 1fr auto',
            }}
          >
            <div
              data-shell-section="top-nav"
              style={{ gridColumn: '1 / -1', gridRow: '1' }}
            >
              {top}
            </div>
            <div
              data-shell-section="left-rail"
              style={{ gridColumn: '1', gridRow: '2' }}
              className="min-h-0"
            >
              {rail}
            </div>
            <div
              data-shell-section="main-pane"
              style={{ gridColumn: '2', gridRow: '2' }}
              className="min-h-0 min-w-0"
            >
              {main}
            </div>
            <div
              data-shell-section="chat-dock"
              style={{ gridColumn: '3', gridRow: '2' }}
              className="min-h-0"
            >
              {dock}
            </div>
          </div>
        </ToastProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
