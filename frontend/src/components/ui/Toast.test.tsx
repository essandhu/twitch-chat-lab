import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Toast, ToastProvider } from './Toast'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

type HarnessProps = {
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
  rootClassName?: string
}

const Harness = ({
  initialOpen = true,
  onOpenChange,
  rootClassName,
}: HarnessProps) => {
  const [open, setOpen] = useState(initialOpen)
  return (
    <ToastProvider>
      <Toast.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          onOpenChange?.(next)
        }}
        className={rootClassName}
      >
        <Toast.Title>Hello</Toast.Title>
        <Toast.Description>Body</Toast.Description>
        <Toast.Close>Dismiss</Toast.Close>
      </Toast.Root>
    </ToastProvider>
  )
}

describe('Toast', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders open toast in dark theme', async () => {
    render(<Harness />)
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })
  })

  it('renders open toast in light theme', async () => {
    setTheme('light')
    render(<Harness />)
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })
  })

  it('does not render when open is false', () => {
    render(<Harness initialOpen={false} />)
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
  })

  it('fires onOpenChange(false) when close clicked', async () => {
    const onOpenChange = vi.fn()
    render(<Harness onOpenChange={onOpenChange} />)
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Dismiss'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('forwards className to root', async () => {
    render(<Harness rootClassName="custom-x" />)
    await waitFor(() => {
      expect(document.querySelector('.custom-x')).not.toBeNull()
    })
  })
})
