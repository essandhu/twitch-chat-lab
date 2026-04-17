import { act, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LandingView } from './App'
import { useChatStore } from './store/chatStore'
import { usePerfStore } from './store/perfStore'
import type { StreamSession } from './types/twitch'

const fireKey = (init: KeyboardEventInit) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init))
  })
}

const makeSession = (): StreamSession => ({
  broadcasterId: 'b1',
  broadcasterLogin: 'b',
  broadcasterDisplayName: 'B',
  streamTitle: '',
  gameName: '',
  gameId: '',
  viewerCount: 0,
  startedAt: new Date(),
  isConnected: true,
})

const renderLanding = () =>
  render(
    <MemoryRouter>
      <LandingView />
    </MemoryRouter>,
  )

describe('App / LandingView — Ctrl+Shift+P hotkey', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
    usePerfStore.getState().reset()
    useChatStore.setState({ session: makeSession() })
  })

  afterEach(() => {
    vi.useRealTimers()
    usePerfStore.getState().reset()
    useChatStore.setState({ session: null })
  })

  it('toggles perf overlay visibility on Ctrl+Shift+P (lowercase p)', () => {
    renderLanding()
    expect(usePerfStore.getState().isVisible).toBe(false)
    fireKey({ key: 'p', ctrlKey: true, shiftKey: true })
    expect(usePerfStore.getState().isVisible).toBe(true)
  })

  it('toggles perf overlay visibility on Ctrl+Shift+P (uppercase P)', () => {
    renderLanding()
    expect(usePerfStore.getState().isVisible).toBe(false)
    fireKey({ key: 'P', ctrlKey: true, shiftKey: true })
    expect(usePerfStore.getState().isVisible).toBe(true)
  })

  it('does NOT toggle when only Shift+P is pressed (no ctrl)', () => {
    renderLanding()
    expect(usePerfStore.getState().isVisible).toBe(false)
    fireKey({ key: 'p', shiftKey: true })
    expect(usePerfStore.getState().isVisible).toBe(false)
  })

  it('does NOT toggle when altKey is also held (Ctrl+Alt+Shift+P)', () => {
    renderLanding()
    expect(usePerfStore.getState().isVisible).toBe(false)
    fireKey({ key: 'p', ctrlKey: true, shiftKey: true, altKey: true })
    expect(usePerfStore.getState().isVisible).toBe(false)
  })

  it('does NOT toggle when metaKey is also held', () => {
    renderLanding()
    expect(usePerfStore.getState().isVisible).toBe(false)
    fireKey({ key: 'p', ctrlKey: true, shiftKey: true, metaKey: true })
    expect(usePerfStore.getState().isVisible).toBe(false)
  })

  it('removes the listener on unmount (no further toggles)', () => {
    const { unmount } = renderLanding()
    fireKey({ key: 'p', ctrlKey: true, shiftKey: true })
    expect(usePerfStore.getState().isVisible).toBe(true)
    unmount()
    fireKey({ key: 'p', ctrlKey: true, shiftKey: true })
    // Still true — listener was removed, no toggle back to false.
    expect(usePerfStore.getState().isVisible).toBe(true)
  })
})

describe('App / LandingView — layout with session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
    usePerfStore.getState().reset()
    useChatStore.setState({ session: makeSession() })
  })

  afterEach(() => {
    vi.useRealTimers()
    usePerfStore.getState().reset()
    useChatStore.setState({ session: null })
  })

  it('renders a two-column grid (chat + heatmap) when session exists', () => {
    const { container } = renderLanding()
    const main = container.querySelector('main')
    expect(main).not.toBeNull()
    expect(main?.className).toContain('grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')
    // Direct section children of <main>: chat (column 1) + heatmap (column 2).
    const directSections = Array.from(main?.children ?? []).filter(
      (c) => c.tagName === 'SECTION',
    )
    expect(directSections.length).toBe(2)
  })
})

describe('App / LandingView — no session', () => {
  beforeEach(() => {
    usePerfStore.getState().reset()
    useChatStore.setState({ session: null })
  })

  afterEach(() => {
    usePerfStore.getState().reset()
  })

  it('renders the ConnectForm landing view unchanged when session is null', () => {
    const { container, getByText } = renderLanding()
    // Phase 2 preserved bits.
    expect(getByText('twitch · chat · lab')).toBeInTheDocument()
    expect(getByText('phase 01 · foundation')).toBeInTheDocument()
    // No <main> grid in the disconnected view.
    expect(container.querySelector('main')).toBeNull()
  })
})
