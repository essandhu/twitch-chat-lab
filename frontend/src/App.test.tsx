import { act, render, screen, waitFor } from '@testing-library/react'
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

describe('App / LandingView — demo mode', () => {
  const originalSearch = window.location.search

  beforeEach(() => {
    useChatStore.setState({ session: null })
    usePerfStore.getState().reset()
  })

  afterEach(() => {
    window.history.replaceState({}, '', `/${originalSearch}`)
    useChatStore.setState({ session: null })
    usePerfStore.getState().reset()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('on ?demo=playwright: renders the DemoBanner, skips ConnectForm, triggers startDemoSession', async () => {
    const startDemoSession = vi.fn().mockResolvedValue(undefined)
    vi.doMock('./features/auth/demoSession', () => ({ startDemoSession }))
    vi.resetModules()
    window.history.replaceState({}, '', '/?demo=playwright')

    const { LandingView: ReloadedLanding } = await import('./App')
    render(
      <MemoryRouter>
        <ReloadedLanding />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status', { name: /demo mode/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/twitch channel login/i)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(startDemoSession).toHaveBeenCalledOnce()
    })
    expect(startDemoSession).toHaveBeenCalledWith({
      channel: 'demouser',
      userId: '99999999',
      token: 'PLAYWRIGHT_FIXTURE_TOKEN',
      mode: 'fixture',
    })
  })

  it('on ?demo=1 with missing env vars: renders the misconfig notice and still allows ConnectForm', async () => {
    vi.stubEnv('VITE_DEMO_USER_ID', '')
    vi.stubEnv('VITE_DEMO_TOKEN', '')
    window.history.replaceState({}, '', '/?demo=1')

    vi.resetModules()
    const { LandingView: ReloadedLanding } = await import('./App')
    render(
      <MemoryRouter>
        <ReloadedLanding />
      </MemoryRouter>,
    )

    expect(screen.getByText(/demo mode not configured/i)).toBeInTheDocument()
    // ConnectForm remains available as a fallback.
    expect(screen.getByLabelText(/twitch channel login/i)).toBeInTheDocument()
  })

  it('renders the "demo unavailable" notice when startDemoSession rejects', async () => {
    const startDemoSession = vi
      .fn()
      .mockRejectedValue(new Error('no live demo channel available'))
    vi.doMock('./features/auth/demoSession', () => ({ startDemoSession }))
    vi.resetModules()
    window.history.replaceState({}, '', '/?demo=playwright')

    const { LandingView: ReloadedLanding } = await import('./App')
    render(
      <MemoryRouter>
        <ReloadedLanding />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/demo unavailable/i)
    })
    // No static fallback — ConnectForm is still offered beneath the error.
    expect(screen.getByLabelText(/twitch channel login/i)).toBeInTheDocument()
  })
})
