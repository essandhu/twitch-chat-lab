import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { IconButton } from './IconButton'
import { TooltipProvider } from './Tooltip'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

const Icon = () => <svg data-testid="icon" />

describe('IconButton', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders in dark theme', () => {
    render(
      <IconButton aria-label="Star">
        <Icon />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
  })

  it('renders in light theme', () => {
    setTheme('light')
    render(
      <IconButton aria-label="Star">
        <Icon />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
  })

  it('applies square size classes', () => {
    render(
      <IconButton aria-label="S" size="lg">
        <Icon />
      </IconButton>,
    )
    const el = screen.getByRole('button', { name: 'S' })
    expect(el.className).toMatch(/h-11/)
    expect(el.className).toMatch(/w-11/)
  })

  it('applies variant class', () => {
    render(
      <IconButton aria-label="D" variant="danger">
        <Icon />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'D' }).className).toMatch(
      /bg-danger/,
    )
  })

  it('forwards className', () => {
    render(
      <IconButton aria-label="X" className="x-extra">
        <Icon />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'X' }).className).toMatch(
      /x-extra/,
    )
  })

  it('forwards ref', () => {
    const ref = React.createRef<HTMLButtonElement>()
    render(
      <IconButton aria-label="R" ref={ref}>
        <Icon />
      </IconButton>,
    )
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })

  it('defaults aria-label from tooltip when absent', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton tooltip="Settings">
          <Icon />
        </IconButton>
      </TooltipProvider>,
    )
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })

  it('shows tooltip content on hover', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton tooltip="Hello">
          <Icon />
        </IconButton>
      </TooltipProvider>,
    )
    await user.hover(screen.getByRole('button', { name: 'Hello' }))
    await waitFor(() => {
      expect(screen.getAllByText('Hello').length).toBeGreaterThan(0)
    })
  })
})
