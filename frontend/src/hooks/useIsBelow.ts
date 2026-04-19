import { useEffect, useState } from 'react'

export const useIsBelow = (maxWidthPx: number): boolean => {
  const [isBelow, setIsBelow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(`(max-width: ${maxWidthPx - 1}px)`).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(`(max-width: ${maxWidthPx - 1}px)`)
    const handler = (e: MediaQueryListEvent) => setIsBelow(e.matches)
    setIsBelow(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [maxWidthPx])

  return isBelow
}
