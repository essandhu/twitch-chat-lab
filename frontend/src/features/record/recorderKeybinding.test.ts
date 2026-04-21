import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRecorderToggle } from './recorderKeybinding'

const fireKey = (init: KeyboardEventInit) => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', init))
  })
}

describe('useRecorderToggle', () => {
  beforeEach(() => {
    // Ensure body has focus so skip-when-typing check sees a benign element.
    document.body.focus()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('fires callback on Ctrl+Shift+R (lowercase r)', () => {
    const cb = vi.fn()
    renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('fires callback on Ctrl+Shift+R (uppercase R)', () => {
    const cb = vi.fn()
    renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'R', ctrlKey: true, shiftKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('fires callback on Cmd+Shift+R (metaKey on macOS)', () => {
    const cb = vi.fn()
    renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'r', metaKey: true, shiftKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire when only Shift+R is pressed (no modifier)', () => {
    const cb = vi.fn()
    renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'r', shiftKey: true })
    expect(cb).not.toHaveBeenCalled()
  })

  it('does NOT fire when focus is in an input element', () => {
    const cb = vi.fn()
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(cb).not.toHaveBeenCalled()
  })

  it('does NOT fire when focus is in a textarea element', () => {
    const cb = vi.fn()
    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()
    renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(cb).not.toHaveBeenCalled()
  })

  it('does NOT fire when focus is in a contenteditable element', () => {
    const cb = vi.fn()
    const div = document.createElement('div')
    div.setAttribute('contenteditable', 'true')
    div.tabIndex = 0
    document.body.appendChild(div)
    div.focus()
    renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(cb).not.toHaveBeenCalled()
  })

  it('removes listener on unmount', () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => useRecorderToggle(cb))
    fireKey({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
    unmount()
    fireKey({ key: 'r', ctrlKey: true, shiftKey: true })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('calls preventDefault on matched keydown', () => {
    const cb = vi.fn()
    renderHook(() => useRecorderToggle(cb))
    const event = new KeyboardEvent('keydown', {
      key: 'r',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
  })
})
