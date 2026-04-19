import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useIsBelow } from './useIsBelow'

type MediaQueryListeners = {
  listeners: Set<(e: MediaQueryListEvent) => void>
  matches: boolean
  query: string
  fire: (matches: boolean) => void
}

let media: MediaQueryListeners

beforeEach(() => {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  media = {
    listeners,
    matches: false,
    query: '',
    fire(matches: boolean) {
      this.matches = matches
      for (const l of listeners) l({ matches } as MediaQueryListEvent)
    },
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => {
      media.query = q
      return {
        get matches() {
          return media.matches
        },
        media: q,
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
      }
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useIsBelow', () => {
  test('returns initial matchMedia result (true)', () => {
    media.matches = true
    const { result } = renderHook(() => useIsBelow(768))
    expect(result.current).toBe(true)
  })

  test('returns initial matchMedia result (false)', () => {
    media.matches = false
    const { result } = renderHook(() => useIsBelow(768))
    expect(result.current).toBe(false)
  })

  test('subscribes to matchMedia with (max-width: N-1px)', () => {
    renderHook(() => useIsBelow(768))
    expect(media.query).toBe('(max-width: 767px)')
  })

  test('flips when matchMedia change event fires', () => {
    media.matches = false
    const { result } = renderHook(() => useIsBelow(1280))
    expect(result.current).toBe(false)
    act(() => media.fire(true))
    expect(result.current).toBe(true)
    act(() => media.fire(false))
    expect(result.current).toBe(false)
  })

  test('cleans up matchMedia listener on unmount', () => {
    const { unmount } = renderHook(() => useIsBelow(1024))
    expect(media.listeners.size).toBeGreaterThan(0)
    unmount()
    expect(media.listeners.size).toBe(0)
  })
})
