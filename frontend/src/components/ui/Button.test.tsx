import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

describe('Button', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders in dark theme', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
  })

  it('renders in light theme', () => {
    setTheme('light')
    render(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
  })

  it('applies variant + size classes', () => {
    render(
      <Button variant="danger" size="lg">
        X
      </Button>,
    )
    const el = screen.getByRole('button', { name: 'X' })
    expect(el.className).toMatch(/bg-danger/)
    expect(el.className).toMatch(/h-11/)
  })

  it('forwards className', () => {
    render(<Button className="x-extra">Y</Button>)
    expect(screen.getByRole('button', { name: 'Y' }).className).toMatch(
      /x-extra/,
    )
  })

  it('forwards ref', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(<Button ref={ref}>Z</Button>)
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('fires onClick on Enter and Space', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Press</Button>)
    const btn = screen.getByRole('button', { name: 'Press' })
    btn.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('disables clicks when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled>
        D
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'D' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders an anchor when asChild wraps <a>', () => {
    render(
      <Button asChild>
        <a href="/x">Link</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link.tagName).toBe('A')
  })
})
