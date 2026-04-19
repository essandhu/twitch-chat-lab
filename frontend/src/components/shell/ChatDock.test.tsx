import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ChatDock } from './ChatDock'

const WIDTH_KEY = 'tcl.chat-dock.width'
const COLLAPSED_KEY = 'tcl.chat-dock.collapsed'

const getRoot = (): HTMLElement => {
  const root = document.querySelector('[data-shell-section="chat-dock"]')
  if (!root) throw new Error('ChatDock root not found')
  return root as HTMLElement
}

const getWidth = (): number => {
  const root = getRoot()
  return parseInt(root.style.width, 10)
}

beforeEach(() => {
  localStorage.removeItem(WIDTH_KEY)
  localStorage.removeItem(COLLAPSED_KEY)
})

describe('ChatDock', () => {
  it('renders children when expanded (default)', () => {
    render(
      <ChatDock>
        <p>chat-content</p>
      </ChatDock>,
    )
    expect(screen.getByText('chat-content')).toBeInTheDocument()
  })

  it('renders collapsed "Chat" tab when localStorage says collapsed; children not rendered', () => {
    localStorage.setItem(COLLAPSED_KEY, 'true')
    render(
      <ChatDock>
        <p>chat-content</p>
      </ChatDock>,
    )
    expect(screen.queryByText('chat-content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /expand chat/i })).toBeInTheDocument()
    expect(screen.getByText('Chat')).toBeInTheDocument()
    expect(getWidth()).toBe(40)
  })

  it('defaults to width 340 when localStorage empty', () => {
    render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    expect(getWidth()).toBe(340)
  })

  it('reads persisted width from localStorage', () => {
    localStorage.setItem(WIDTH_KEY, '400')
    render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    expect(getWidth()).toBe(400)
  })

  it('falls back to 340 when stored width is unparseable, empty, or out of bounds', () => {
    localStorage.setItem(WIDTH_KEY, 'abc')
    const { unmount } = render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    expect(getWidth()).toBe(340)
    unmount()

    localStorage.setItem(WIDTH_KEY, '')
    const { unmount: u2 } = render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    expect(getWidth()).toBe(340)
    u2()

    localStorage.setItem(WIDTH_KEY, '100')
    const { unmount: u3 } = render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    expect(getWidth()).toBe(340)
    u3()

    localStorage.setItem(WIDTH_KEY, '900')
    render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    expect(getWidth()).toBe(340)
  })

  it('Ctrl+Shift+C toggles collapsed and persists to localStorage', () => {
    render(
      <ChatDock>
        <p>chat-content</p>
      </ChatDock>,
    )
    expect(getWidth()).toBe(340)

    act(() => {
      fireEvent.keyDown(window, { key: 'c', ctrlKey: true, shiftKey: true })
    })
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe('true')
    expect(getWidth()).toBe(40)
    expect(screen.queryByText('chat-content')).not.toBeInTheDocument()

    act(() => {
      fireEvent.keyDown(window, { key: 'C', ctrlKey: true, shiftKey: true })
    })
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe('false')
    expect(getWidth()).toBeGreaterThanOrEqual(240)
    expect(screen.getByText('chat-content')).toBeInTheDocument()
  })

  it('Ctrl+Shift+C is skipped when focus is in a textarea', () => {
    render(
      <>
        <textarea data-testid="ta" />
        <ChatDock>
          <p>chat-content</p>
        </ChatDock>
      </>,
    )
    const ta = screen.getByTestId('ta') as HTMLTextAreaElement
    ta.focus()
    expect(document.activeElement).toBe(ta)

    act(() => {
      fireEvent.keyDown(window, { key: 'c', ctrlKey: true, shiftKey: true })
    })
    expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull()
    expect(getWidth()).toBe(340)
    expect(screen.getByText('chat-content')).toBeInTheDocument()
  })

  it('drag handle resizes the dock (dragging left increases width)', () => {
    render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    const handle = screen.getByTestId('chat-dock-handle')

    act(() => {
      fireEvent.pointerDown(handle, { clientX: 1000 })
    })
    act(() => {
      fireEvent.pointerMove(window, { clientX: 900 })
    })
    expect(getWidth()).toBe(440)

    act(() => {
      fireEvent.pointerUp(window, { clientX: 900 })
    })
    expect(localStorage.getItem(WIDTH_KEY)).toBe('440')
  })

  it('drag clamps to [240, 480]', () => {
    render(
      <ChatDock>
        <p>c</p>
      </ChatDock>,
    )
    const handle = screen.getByTestId('chat-dock-handle')

    // Drag RIGHT to shrink below 240 -> clamps at 240
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 1000 })
    })
    act(() => {
      fireEvent.pointerMove(window, { clientX: 1200 }) // shrink by 200 => 140 => clamp 240
    })
    expect(getWidth()).toBe(240)
    act(() => {
      fireEvent.pointerUp(window, { clientX: 1200 })
    })
    expect(localStorage.getItem(WIDTH_KEY)).toBe('240')

    // Drag LEFT to expand beyond 480 -> clamps at 480
    act(() => {
      fireEvent.pointerDown(handle, { clientX: 1000 })
    })
    act(() => {
      fireEvent.pointerMove(window, { clientX: 500 }) // +500 => 740 => clamp 480
    })
    expect(getWidth()).toBe(480)
    act(() => {
      fireEvent.pointerUp(window, { clientX: 500 })
    })
    expect(localStorage.getItem(WIDTH_KEY)).toBe('480')
  })

  it('clicking the collapsed "Chat" tab re-expands the dock', async () => {
    localStorage.setItem(COLLAPSED_KEY, 'true')
    const user = userEvent.setup()
    render(
      <ChatDock>
        <p>chat-content</p>
      </ChatDock>,
    )
    expect(screen.queryByText('chat-content')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expand chat/i }))
    expect(screen.getByText('chat-content')).toBeInTheDocument()
    expect(getWidth()).toBeGreaterThanOrEqual(240)
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe('false')
  })
})
