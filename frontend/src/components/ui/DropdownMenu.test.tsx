import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DropdownMenu } from './DropdownMenu'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

const openMenu = (trigger: HTMLElement) => {
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

const Example = ({
  onSelect,
  defaultOpen,
}: {
  onSelect?: () => void
  defaultOpen?: boolean
}) => (
  <DropdownMenu.Root defaultOpen={defaultOpen}>
    <DropdownMenu.Trigger>Open menu</DropdownMenu.Trigger>
    <DropdownMenu.Content className="custom-x">
      <DropdownMenu.Label>Section</DropdownMenu.Label>
      <DropdownMenu.Item onSelect={onSelect}>First</DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item>Second</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
)

describe('DropdownMenu', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders trigger in dark theme', () => {
    render(<Example />)
    expect(screen.getByText('Open menu')).toBeInTheDocument()
  })

  it('renders trigger in light theme', () => {
    setTheme('light')
    render(<Example />)
    expect(screen.getByText('Open menu')).toBeInTheDocument()
  })

  it('opens on Enter and shows items', async () => {
    render(<Example />)
    openMenu(screen.getByText('Open menu'))
    await waitFor(() => {
      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
    })
  })

  it('invokes onSelect when item is activated', async () => {
    const onSelect = vi.fn()
    render(<Example onSelect={onSelect} defaultOpen />)
    await waitFor(() => {
      expect(screen.getByText('First')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('First'))
    expect(onSelect).toHaveBeenCalled()
  })

  it('forwards className to content', async () => {
    render(<Example defaultOpen />)
    await waitFor(() => {
      expect(document.querySelector('.custom-x')).not.toBeNull()
    })
  })
})
