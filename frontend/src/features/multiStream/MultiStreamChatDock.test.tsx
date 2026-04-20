import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { ToastProvider } from '../../components/ui/Toast'
import { MultiStreamChatDock } from './MultiStreamChatDock'

const VIEWPORT_HEIGHT = 600
const VIEWPORT_WIDTH = 400
const saved: Array<[PropertyKey, PropertyDescriptor | undefined]> = []
const origRect = HTMLElement.prototype.getBoundingClientRect

const installLayoutStub = (): void => {
  saved.length = 0
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  for (const key of ['offsetHeight', 'offsetWidth', 'clientHeight', 'clientWidth'] as const) {
    saved.push([key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)])
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get() {
        return key.includes('Height') ? VIEWPORT_HEIGHT : VIEWPORT_WIDTH
      },
    })
  }
  HTMLElement.prototype.getBoundingClientRect = function () {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: VIEWPORT_WIDTH,
      bottom: VIEWPORT_HEIGHT,
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      toJSON: () => ({}),
    } as DOMRect
  }
}

const removeLayoutStub = (): void => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(HTMLElement.prototype, key, desc)
    else delete (HTMLElement.prototype as unknown as Record<PropertyKey, unknown>)[key]
  }
  saved.length = 0
  HTMLElement.prototype.getBoundingClientRect = origRect
}

describe('MultiStreamChatDock', () => {
  beforeEach(() => {
    installLayoutStub()
    localStorage.clear()
    useMultiStreamStore.getState().reset()
  })

  afterEach(() => {
    removeLayoutStub()
    localStorage.clear()
  })

  it('renders the Spotlight tab and a SpotlightFeed', () => {
    render(
      <ToastProvider>
        <MultiStreamChatDock />
      </ToastProvider>,
    )
    expect(screen.getByText('Spotlight')).toBeInTheDocument()
    expect(screen.getByTestId('spotlight-feed')).toBeInTheDocument()
  })

  it('persists the active tab value to localStorage', () => {
    const { rerender } = render(
      <ToastProvider>
        <MultiStreamChatDock />
      </ToastProvider>,
    )
    // Default 'spotlight' is written on mount effect.
    expect(localStorage.getItem('tcl.multi-dock.tab')).toBe('spotlight')
    // Simulate restore — remount reads same value.
    rerender(
      <ToastProvider>
        <MultiStreamChatDock />
      </ToastProvider>,
    )
    expect(localStorage.getItem('tcl.multi-dock.tab')).toBe('spotlight')
  })

  it('compare-toggle churn: swapping isActive cleanly unmounts and remounts content', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Test = () => {
      const active = useMultiStreamStore((s) => s.isActive)
      return active ? (
        <ToastProvider>
          <MultiStreamChatDock />
        </ToastProvider>
      ) : (
        <div data-testid="placeholder">placeholder</div>
      )
    }

    const { container } = render(<Test />)

    // Cycle false → true → false → true under React render commits.
    for (let i = 0; i < 2; i++) {
      act(() => {
        useMultiStreamStore.setState({ isActive: true })
      })
      expect(container.querySelector('[data-testid="spotlight-feed"]')).toBeInTheDocument()
      expect(container.querySelector('[data-testid="placeholder"]')).toBeNull()

      act(() => {
        useMultiStreamStore.setState({ isActive: false })
      })
      expect(container.querySelector('[data-testid="spotlight-feed"]')).toBeNull()
      expect(container.querySelector('[data-testid="placeholder"]')).toBeInTheDocument()
    }

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
