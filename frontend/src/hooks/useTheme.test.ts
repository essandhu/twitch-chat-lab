import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { ThemeProvider } from '../components/ThemeProvider'
import { useTheme } from './useTheme'

const wrap =
  () =>
  ({ children }: { children: ReactNode }) =>
    createElement(ThemeProvider, null, children)

type MediaQueryListeners = {
  listeners: Set<(e: MediaQueryListEvent) => void>
  set matches(v: boolean)
  get matches(): boolean
  fire(matches: boolean): void
}

let media: MediaQueryListeners

beforeEach(() => {
  localStorage.removeItem('tcl.theme')
  document.documentElement.removeAttribute('data-theme')
  let m = false
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  media = {
    listeners,
    get matches() {
      return m
    },
    set matches(v: boolean) {
      m = v
    },
    fire(matches: boolean) {
      m = matches
      for (const l of listeners) l({ matches } as MediaQueryListEvent)
    },
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      get matches() {
        return media.matches
      },
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_evt: string, cb: (e: MediaQueryListEvent) => void) => {
        media.listeners.add(cb)
      },
      removeEventListener: (_evt: string, cb: (e: MediaQueryListEvent) => void) => {
        media.listeners.delete(cb)
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTheme', () => {
  test('throws when used outside ThemeProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useTheme())).toThrow(/ThemeProvider/)
    spy.mockRestore()
  })

  test('returns theme="system" when localStorage empty', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrap() })
    expect(result.current.theme).toBe('system')
  })

  test('returns persisted theme from localStorage on mount', () => {
    localStorage.setItem('tcl.theme', 'light')
    const { result } = renderHook(() => useTheme(), { wrapper: wrap() })
    expect(result.current.theme).toBe('light')
  })

  test('resolvedTheme resolves system via matchMedia (dark)', () => {
    media.matches = true
    const { result } = renderHook(() => useTheme(), { wrapper: wrap() })
    expect(result.current.resolvedTheme).toBe('dark')
  })

  test('resolvedTheme resolves system via matchMedia (light)', () => {
    media.matches = false
    const { result } = renderHook(() => useTheme(), { wrapper: wrap() })
    expect(result.current.resolvedTheme).toBe('light')
  })

  test('resolvedTheme equals explicit theme when not system', () => {
    localStorage.setItem('tcl.theme', 'dark')
    media.matches = false
    const { result } = renderHook(() => useTheme(), { wrapper: wrap() })
    expect(result.current.resolvedTheme).toBe('dark')
  })
})

describe('ThemeProvider', () => {
  test('writes data-theme=dark on mount when matchMedia matches and theme=system', () => {
    media.matches = true
    renderHook(() => useTheme(), { wrapper: wrap() })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  test('writes data-theme=light on mount when matchMedia does not match and theme=system', () => {
    media.matches = false
    renderHook(() => useTheme(), { wrapper: wrap() })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  test('setTheme persists choice to localStorage and updates data-theme', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrap() })
    act(() => result.current.setTheme('light'))
    expect(localStorage.getItem('tcl.theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    act(() => result.current.setTheme('dark'))
    expect(localStorage.getItem('tcl.theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  test('OS preference change updates data-theme when theme=system', () => {
    media.matches = false
    renderHook(() => useTheme(), { wrapper: wrap() })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    act(() => media.fire(true))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  test('OS preference change does NOT update data-theme when theme=dark', () => {
    localStorage.setItem('tcl.theme', 'dark')
    media.matches = false
    renderHook(() => useTheme(), { wrapper: wrap() })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    act(() => media.fire(true))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  test('OS preference change does NOT update data-theme when theme=light', () => {
    localStorage.setItem('tcl.theme', 'light')
    media.matches = true
    renderHook(() => useTheme(), { wrapper: wrap() })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    act(() => media.fire(false))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  test('unmount removes matchMedia listener', () => {
    const { unmount } = renderHook(() => useTheme(), { wrapper: wrap() })
    expect(media.listeners.size).toBeGreaterThan(0)
    unmount()
    expect(media.listeners.size).toBe(0)
  })

  test('switching from system to dark drops the matchMedia listener', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrap() })
    expect(media.listeners.size).toBeGreaterThan(0)
    act(() => result.current.setTheme('dark'))
    expect(media.listeners.size).toBe(0)
  })
})
