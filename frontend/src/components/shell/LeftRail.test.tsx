import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { TooltipProvider } from '../ui/Tooltip'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { LeftRail } from './LeftRail'

type MediaListener = (e: MediaQueryListEvent) => void

const stubMatchMedia = (matcher: (q: string) => boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      get matches() {
        return matcher(q)
      },
      media: q,
      onchange: null,
      addEventListener: (_evt: string, _cb: MediaListener) => {},
      removeEventListener: (_evt: string, _cb: MediaListener) => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
}

vi.mock('../../store/multiStreamStore', () => ({
  useMultiStreamStore: vi.fn(),
}))

type StreamFixture = {
  login: string
  displayName: string
  broadcasterId: string
}

const fixtureStreams = (entries: StreamFixture[]): Record<string, StreamFixture> => {
  const out: Record<string, StreamFixture> = {}
  for (const s of entries) out[s.login] = s
  return out
}

const setStreams = (streams: Record<string, StreamFixture>) => {
  ;(useMultiStreamStore as unknown as Mock).mockImplementation(
    (selector: (state: { streams: Record<string, StreamFixture> }) => unknown) =>
      selector({ streams }),
  )
}

const renderRail = (initialPath = '/') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <TooltipProvider>
        <LeftRail />
      </TooltipProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  localStorage.removeItem('tcl.rail.collapsed')
  setStreams({})
  stubMatchMedia(() => false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LeftRail', () => {
  it('renders Home / Followed / Browse nav items', () => {
    renderRail()
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /followed/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse/i })).toBeInTheDocument()
  })

  it('renders tracked streams from mocked store', () => {
    setStreams(
      fixtureStreams([
        { login: 'alice', displayName: 'AliceStream', broadcasterId: '1' },
        { login: 'bob', displayName: 'BobStream', broadcasterId: '2' },
      ]),
    )
    renderRail()
    expect(screen.getByText('AliceStream')).toBeInTheDocument()
    expect(screen.getByText('BobStream')).toBeInTheDocument()
  })

  it('handles empty tracked streams list cleanly', () => {
    setStreams({})
    renderRail()
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument()
  })

  it('marks Home active when route is /', () => {
    renderRail('/')
    const home = screen.getByRole('button', { name: /home/i })
    expect(home.getAttribute('aria-current')).toBe('page')
  })

  it('does not mark Home active on other routes', () => {
    renderRail('/other')
    const home = screen.getByRole('button', { name: /home/i })
    expect(home.getAttribute('aria-current')).not.toBe('page')
  })

  it('persists collapsed state via localStorage', async () => {
    const user = userEvent.setup()
    const first = renderRail()
    const root = first.container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.style.width).toBe('240px')

    const toggle = screen.getByRole('button', { name: /collapse rail/i })
    await user.click(toggle)

    expect(localStorage.getItem('tcl.rail.collapsed')).toBe('true')
    first.unmount()

    const second = renderRail()
    const root2 = second.container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root2.style.width).toBe('60px')
  })

  it('toggles collapsed on Ctrl+B', () => {
    const { container } = renderRail()
    const root = container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root.style.width).toBe('240px')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))
    })

    expect(root.style.width).toBe('60px')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))
    })

    expect(root.style.width).toBe('240px')
  })

  it('skips Ctrl+B when focus is in a textarea', () => {
    const { container } = render(
      <MemoryRouter>
        <TooltipProvider>
          <LeftRail />
          <textarea data-testid="ta" />
        </TooltipProvider>
      </MemoryRouter>,
    )
    const root = container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root.style.width).toBe('240px')

    const ta = screen.getByTestId('ta') as HTMLTextAreaElement
    ta.focus()
    expect(document.activeElement).toBe(ta)

    act(() => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }))
    })

    expect(root.style.width).toBe('240px')
  })

  it('auto-collapses when no persisted value and viewport < 1280', () => {
    stubMatchMedia((q: string) => q.includes('1279px'))
    const { container } = renderRail()
    const root = container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root.style.width).toBe('60px')
  })

  it('does NOT auto-collapse when viewport ≥ 1280', () => {
    stubMatchMedia(() => false)
    const { container } = renderRail()
    const root = container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root.style.width).toBe('240px')
  })

  it('respects persisted "false" even when viewport < 1280', () => {
    localStorage.setItem('tcl.rail.collapsed', 'false')
    stubMatchMedia((q: string) => q.includes('1279px'))
    const { container } = renderRail()
    const root = container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root.style.width).toBe('240px')
  })

  it('respects persisted "true" even when viewport ≥ 1280', () => {
    localStorage.setItem('tcl.rail.collapsed', 'true')
    stubMatchMedia(() => false)
    const { container } = renderRail()
    const root = container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root.style.width).toBe('60px')
  })

  it('renders differently when collapsed (tracked section header hidden)', async () => {
    const user = userEvent.setup()
    setStreams(
      fixtureStreams([{ login: 'alice', displayName: 'AliceStream', broadcasterId: '1' }]),
    )
    const { container } = renderRail()
    expect(screen.getByText('TRACKED')).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /collapse rail/i })
    await user.click(toggle)

    const root = container.querySelector('[data-shell-section="left-rail"]') as HTMLElement
    expect(root.style.width).toBe('60px')
    expect(screen.queryByText('TRACKED')).not.toBeInTheDocument()
    // Avatar fallback should still be visible with first letter
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
