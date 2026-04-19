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

const stubMatchMedia = () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
}

const renderLanding = () =>
  render(
    <MemoryRouter>
      <LandingView />
    </MemoryRouter>,
  )

describe('App / LandingView — Ctrl+Shift+P hotkey', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia()
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
    vi.unstubAllGlobals()
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
    expect(usePerfStore.getState().isVisible).toBe(true)
  })
})

describe('App / LandingView — shell layout with session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubMatchMedia()
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
    vi.unstubAllGlobals()
    usePerfStore.getState().reset()
    useChatStore.setState({ session: null })
  })

  it('renders AppShell with all four slots when session exists', () => {
    const { container } = renderLanding()
    expect(container.querySelector('[data-shell-section="top-nav"]')).not.toBeNull()
    expect(container.querySelector('[data-shell-section="left-rail"]')).not.toBeNull()
    expect(container.querySelector('[data-shell-section="main-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-shell-section="chat-dock"]')).not.toBeNull()
  })

  it('renders First-Timers + Heatmap tabs inside MainPane when not in multi-stream mode', () => {
    renderLanding()
    expect(screen.getByRole('tab', { name: /first-timers/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /heatmap/i })).toBeInTheDocument()
  })
})

describe('App / LandingView — no session', () => {
  beforeEach(() => {
    stubMatchMedia()
    usePerfStore.getState().reset()
    useChatStore.setState({ session: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    usePerfStore.getState().reset()
  })

  it('renders the ConnectForm inside the shell when session is null', () => {
    renderLanding()
    expect(screen.getByLabelText(/twitch channel login/i)).toBeInTheDocument()
  })

  it('renders the wordmark in the top nav', () => {
    renderLanding()
    expect(screen.getByText(/twitch · chat · lab/i)).toBeInTheDocument()
  })
})

describe('App / LandingView — demo mode', () => {
  const originalSearch = window.location.search

  beforeEach(() => {
    stubMatchMedia()
    useChatStore.setState({ session: null })
    usePerfStore.getState().reset()
  })

  afterEach(() => {
    window.history.replaceState({}, '', `/${originalSearch}`)
    useChatStore.setState({ session: null })
    usePerfStore.getState().reset()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
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
    expect(screen.getByLabelText(/twitch channel login/i)).toBeInTheDocument()
  })
})
