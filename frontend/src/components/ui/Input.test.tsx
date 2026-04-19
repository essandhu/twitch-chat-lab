import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from './Input'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

describe('Input', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders in dark theme', () => {
    render(<Input placeholder="email" />)
    expect(screen.getByPlaceholderText('email')).toBeInTheDocument()
  })

  it('renders in light theme', () => {
    setTheme('light')
    render(<Input placeholder="email" />)
    expect(screen.getByPlaceholderText('email')).toBeInTheDocument()
  })

  it('fires onChange with target.value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input placeholder="x" onChange={onChange} />)
    await user.type(screen.getByPlaceholderText('x'), 'hi')
    expect(onChange).toHaveBeenCalled()
    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last.target.value).toBe('hi')
  })

  it('applies base border when valid', () => {
    render(<Input placeholder="x" />)
    const el = screen.getByPlaceholderText('x')
    expect(el.className).toMatch(/border-border/)
    expect(el.className).not.toMatch(/border-danger/)
  })

  it('applies error border when aria-invalid', () => {
    render(<Input placeholder="x" aria-invalid="true" />)
    const el = screen.getByPlaceholderText('x')
    expect(el.className).toMatch(/border-danger/)
    expect(el.className).toMatch(/focus-visible:ring-danger/)
  })

  it('forwards className + ref', () => {
    const ref = React.createRef<HTMLInputElement>()
    render(<Input ref={ref} className="x-extra" placeholder="x" />)
    const el = screen.getByPlaceholderText('x')
    expect(el.className).toMatch(/x-extra/)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })
})
