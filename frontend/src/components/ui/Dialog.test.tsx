import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Dialog } from './Dialog'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

const Example = ({
  onOpenChange,
}: {
  onOpenChange?: (open: boolean) => void
}) => (
  <Dialog.Root defaultOpen onOpenChange={onOpenChange}>
    <Dialog.Trigger>Open</Dialog.Trigger>
    <Dialog.Content className="custom-x">
      <Dialog.Title>Title</Dialog.Title>
      <Dialog.Description>Description</Dialog.Description>
      <Dialog.Close>Dismiss</Dialog.Close>
    </Dialog.Content>
  </Dialog.Root>
)

describe('Dialog', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders content in dark theme', async () => {
    render(<Example />)
    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument()
    })
  })

  it('renders content in light theme', async () => {
    setTheme('light')
    render(<Example />)
    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument()
    })
  })

  it('closes when close button is clicked', async () => {
    render(<Example />)
    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Dismiss'))
    await waitFor(() => {
      expect(screen.queryByText('Title')).not.toBeInTheDocument()
    })
  })

  it('closes on Escape key', async () => {
    render(<Example />)
    await waitFor(() => {
      expect(screen.getByText('Title')).toBeInTheDocument()
    })
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    await waitFor(() => {
      expect(screen.queryByText('Title')).not.toBeInTheDocument()
    })
  })

  it('forwards className to content', async () => {
    render(<Example />)
    await waitFor(() => {
      const content = document.querySelector('.custom-x')
      expect(content).not.toBeNull()
    })
  })

  it('renders default close icon button', async () => {
    render(<Example />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    })
  })
})
