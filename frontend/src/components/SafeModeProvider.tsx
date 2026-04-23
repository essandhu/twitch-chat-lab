import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react'

export type SafeModeContextValue = {
  safeMode: boolean
  setSafeMode: (next: boolean) => void
  toggleSafeMode: () => void
}

export const SafeModeContext = createContext<SafeModeContextValue | null>(null)

const STORAGE_KEY = 'tcl.safe-mode'

const readStored = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    // Unset → default on. Only an explicit 'false' disables.
    if (raw === null) return true
    return raw !== 'false'
  } catch {
    return true
  }
}

export const SafeModeProvider = ({ children }: { children: ReactNode }) => {
  const [safeMode, setSafeModeState] = useState<boolean>(() => readStored())

  const setSafeMode = useCallback((next: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // ignore persistence failure
    }
    setSafeModeState(next)
  }, [])

  const toggleSafeMode = useCallback(() => {
    setSafeModeState((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  const value = useMemo<SafeModeContextValue>(
    () => ({ safeMode, setSafeMode, toggleSafeMode }),
    [safeMode, setSafeMode, toggleSafeMode],
  )

  return <SafeModeContext.Provider value={value}>{children}</SafeModeContext.Provider>
}
