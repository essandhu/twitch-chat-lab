import {
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useIsBelow } from '../../hooks/useIsBelow'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const readReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export type ResponsiveFlags = {
  isMobile: boolean
  dockDefaultWidth: number
}

export const useResponsiveLayout = (): ResponsiveFlags => {
  const isMobile = useIsBelow(768)
  const isBelow1280 = useIsBelow(1280)
  const isBelow1440 = useIsBelow(1440)

  // Width spec: ≥ 1440 → 400, 1280–1439 → 380, < 1280 → 360. Mobile renders
  // in a sheet so the fallback is mostly cosmetic there.
  let dockDefaultWidth = 400
  if (isBelow1440) dockDefaultWidth = 380
  if (isBelow1280) dockDefaultWidth = 360

  return { isMobile, dockDefaultWidth }
}

export const useReducedMotion = (): boolean => {
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    readReducedMotion(),
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(REDUCED_MOTION_QUERY)
    setReducedMotion(mql.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return reducedMotion
}

/**
 * Clone the dock element with an injected `defaultWidth` prop, if it's a valid
 * component element (not a DOM tag) and does not already specify one. Keeps
 * the AppShell API tiny (just `dock: ReactNode`) while feeding
 * breakpoint-driven defaults into ChatDock without over-coupling.
 */
export const withDockDefaultWidth = (
  dock: ReactNode,
  defaultWidth: number,
): ReactNode => {
  if (!isValidElement(dock)) return dock
  if (typeof dock.type === 'string') return dock
  const existing = (dock.props as { defaultWidth?: number }).defaultWidth
  if (typeof existing === 'number') return dock
  return cloneElement(dock as ReactElement<{ defaultWidth?: number }>, {
    defaultWidth,
  })
}

export const withLeadingRailTrigger = (
  top: ReactNode,
  trigger: ReactNode,
): ReactNode => {
  if (!isValidElement(top)) return top
  if (typeof top.type === 'string') return top
  return cloneElement(top as ReactElement<{ leadingRailTrigger?: ReactNode }>, {
    leadingRailTrigger: trigger,
  })
}
