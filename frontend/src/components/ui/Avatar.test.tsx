import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

describe('Avatar', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders root + fallback in dark theme', () => {
    render(
      <Avatar.Root data-testid="root">
        <Avatar.Fallback>AB</Avatar.Fallback>
      </Avatar.Root>,
    )
    expect(screen.getByTestId('root')).toBeInTheDocument()
    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('renders root + fallback in light theme', () => {
    setTheme('light')
    render(
      <Avatar.Root data-testid="root">
        <Avatar.Fallback>CD</Avatar.Fallback>
      </Avatar.Root>,
    )
    expect(screen.getByTestId('root')).toBeInTheDocument()
    expect(screen.getByText('CD')).toBeInTheDocument()
  })

  it('shows fallback when image src is invalid', async () => {
    render(
      <Avatar.Root>
        <Avatar.Image src="" alt="user" />
        <Avatar.Fallback>XY</Avatar.Fallback>
      </Avatar.Root>,
    )
    await waitFor(() => {
      expect(screen.getByText('XY')).toBeInTheDocument()
    })
  })

  it('forwards className on Root', () => {
    render(
      <Avatar.Root className="custom-x" data-testid="root">
        <Avatar.Fallback>AB</Avatar.Fallback>
      </Avatar.Root>,
    )
    expect(screen.getByTestId('root')).toHaveClass('custom-x')
  })

  it('forwards className on Fallback', () => {
    render(
      <Avatar.Root>
        <Avatar.Fallback className="custom-fb">AB</Avatar.Fallback>
      </Avatar.Root>,
    )
    expect(screen.getByText('AB')).toHaveClass('custom-fb')
  })
})
