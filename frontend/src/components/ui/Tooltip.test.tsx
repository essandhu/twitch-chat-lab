import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Tooltip, TooltipProvider } from './Tooltip'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

const renderWithProvider = (ui: React.ReactElement) =>
  render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>)

describe('Tooltip', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders trigger in dark theme', () => {
    renderWithProvider(
      <Tooltip content="Hello">
        <button>Hover me</button>
      </Tooltip>,
    )
    expect(screen.getByRole('button', { name: 'Hover me' })).toBeInTheDocument()
  })

  it('renders trigger in light theme', () => {
    setTheme('light')
    renderWithProvider(
      <Tooltip content="Hello">
        <button>Hover me</button>
      </Tooltip>,
    )
    expect(screen.getByRole('button', { name: 'Hover me' })).toBeInTheDocument()
  })

  it('shows content when controlled open', async () => {
    renderWithProvider(
      <Tooltip content="Hello" open>
        <button>Hover me</button>
      </Tooltip>,
    )
    await waitFor(() => {
      expect(screen.getAllByText('Hello').length).toBeGreaterThan(0)
    })
  })

  it('forwards className on content', async () => {
    renderWithProvider(
      <Tooltip content="Tip" open className="custom-x">
        <button>Btn</button>
      </Tooltip>,
    )
    await waitFor(() => {
      const found = document.querySelector('.custom-x')
      expect(found).not.toBeNull()
    })
  })
})
