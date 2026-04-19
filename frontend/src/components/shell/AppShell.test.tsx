import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from '../ui/Tooltip'
import { useTheme } from '../../hooks/useTheme'
import { AppShell } from './AppShell'

type MediaListener = (e: MediaQueryListEvent) => void

type FakeMedia = {
  listeners: Set<MediaListener>
  matches: boolean
  fire: (matches: boolean) => void
}

let media: FakeMedia

beforeEach(() => {
  const listeners = new Set<MediaListener>()
  media = {
    listeners,
    matches: false,
    fire(matches: boolean) {
      this.matches = matches
      for (const l of listeners) l({ matches } as MediaQueryListEvent)
    },
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      get matches() {
        return media.matches
      },
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: (_evt: string, cb: MediaListener) => {
        media.listeners.add(cb)
      },
      removeEventListener: (_evt: string, cb: MediaListener) => {
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
  document.documentElement.removeAttribute('data-theme')
})

const ThemeConsumer = () => {
  const { resolvedTheme } = useTheme()
  return <div data-testid="theme-consumer">{resolvedTheme}</div>
}

const renderShell = (overrides?: {
  top?: React.ReactNode
  rail?: React.ReactNode
  main?: React.ReactNode
  dock?: React.ReactNode
}) =>
  render(
    <AppShell
      top={overrides?.top ?? <div>top-content</div>}
      rail={overrides?.rail ?? <div>rail-content</div>}
      main={overrides?.main ?? <div>main-content</div>}
      dock={overrides?.dock ?? <div>dock-content</div>}
    />,
  )

describe('AppShell', () => {
  it('renders all four slot contents exactly once', () => {
    renderShell()
    expect(screen.getAllByText('top-content')).toHaveLength(1)
    expect(screen.getAllByText('rail-content')).toHaveLength(1)
    expect(screen.getAllByText('main-content')).toHaveLength(1)
    expect(screen.getAllByText('dock-content')).toHaveLength(1)
  })

  it('assigns correct data-shell-section attributes to slot wrappers', () => {
    renderShell()
    const top = document.querySelector('[data-shell-section="top-nav"]')
    const rail = document.querySelector('[data-shell-section="left-rail"]')
    const main = document.querySelector('[data-shell-section="main-pane"]')
    const dock = document.querySelector('[data-shell-section="chat-dock"]')
    expect(top).not.toBeNull()
    expect(rail).not.toBeNull()
    expect(main).not.toBeNull()
    expect(dock).not.toBeNull()
    expect(top).toHaveTextContent('top-content')
    expect(rail).toHaveTextContent('rail-content')
    expect(main).toHaveTextContent('main-content')
    expect(dock).toHaveTextContent('dock-content')
  })

  it('mounts ThemeProvider around children (useTheme works in main slot)', () => {
    renderShell({ main: <ThemeConsumer /> })
    expect(screen.getByTestId('theme-consumer')).toBeInTheDocument()
  })

  it('mounts TooltipProvider around children (Tooltip renders without crash)', async () => {
    renderShell({
      main: (
        <Tooltip content="tip-content" open>
          <button>trigger-btn</button>
        </Tooltip>
      ),
    })
    expect(screen.getByRole('button', { name: 'trigger-btn' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText('tip-content').length).toBeGreaterThan(0)
    })
  })

  it('mounts ToastProvider around children (viewport present)', () => {
    renderShell()
    // Radix Toast viewport has role="region" with aria-label containing "notifications"
    const viewport = document.querySelector('[role="region"]')
    expect(viewport).not.toBeNull()
  })

  it('sets data-reduced-motion="true" when matchMedia matches on mount', () => {
    media.matches = true
    renderShell()
    const grid = document.querySelector('[data-app-shell]')
    expect(grid?.getAttribute('data-reduced-motion')).toBe('true')
  })

  it('sets data-reduced-motion="false" when matchMedia does not match on mount', () => {
    media.matches = false
    renderShell()
    const grid = document.querySelector('[data-app-shell]')
    expect(grid?.getAttribute('data-reduced-motion')).toBe('false')
  })

  it('flips data-reduced-motion when matchMedia change event fires', () => {
    media.matches = true
    renderShell()
    const grid = document.querySelector('[data-app-shell]')
    expect(grid?.getAttribute('data-reduced-motion')).toBe('true')
    act(() => media.fire(false))
    expect(grid?.getAttribute('data-reduced-motion')).toBe('false')
  })

  it('cleans up matchMedia listener on unmount', () => {
    const { unmount } = renderShell()
    expect(media.listeners.size).toBeGreaterThan(0)
    unmount()
    expect(media.listeners.size).toBe(0)
  })
})
