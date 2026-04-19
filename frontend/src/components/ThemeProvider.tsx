import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeChoice = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

export type ThemeContextValue = {
  theme: ThemeChoice
  setTheme: (next: ThemeChoice) => void
  resolvedTheme: ResolvedTheme
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'tcl.theme'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

const readStoredTheme = (): ThemeChoice => {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    // localStorage blocked — fall through
  }
  return 'system'
}

const resolveSystem = (): ResolvedTheme => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'
}

const applyThemeAttr = (resolved: ResolvedTheme) => {
  document.documentElement.setAttribute('data-theme', resolved)
}

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<ThemeChoice>(() => readStoredTheme())
  const [systemResolved, setSystemResolved] = useState<ResolvedTheme>(() => resolveSystem())

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemResolved : theme

  useEffect(() => {
    applyThemeAttr(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (theme !== 'system') return
    const mql = window.matchMedia(MEDIA_QUERY)
    setSystemResolved(mql.matches ? 'dark' : 'light')
    const handler = (e: MediaQueryListEvent) => setSystemResolved(e.matches ? 'dark' : 'light')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback((next: ThemeChoice) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore persistence failure
    }
    setThemeState(next)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolvedTheme }),
    [theme, setTheme, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
