import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Skeleton } from './Skeleton'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

describe('Skeleton', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders in dark theme', () => {
    render(<Skeleton data-testid="s" />)
    expect(screen.getByTestId('s')).toBeInTheDocument()
  })

  it('renders in light theme', () => {
    setTheme('light')
    render(<Skeleton data-testid="s" />)
    expect(screen.getByTestId('s')).toBeInTheDocument()
  })

  it('applies animate-pulse and bg-surface-hover', () => {
    render(<Skeleton data-testid="s" />)
    const el = screen.getByTestId('s')
    expect(el.className).toMatch(/animate-pulse/)
    expect(el.className).toMatch(/bg-surface-hover/)
  })

  it('respects prefers-reduced-motion via motion-safe variant', () => {
    render(<Skeleton data-testid="s" />)
    expect(screen.getByTestId('s').className).toMatch(/motion-safe:animate-pulse/)
  })

  it('forwards className + ref', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(<Skeleton ref={ref} className="h-4 w-full" data-testid="s" />)
    const el = screen.getByTestId('s')
    expect(el.className).toMatch(/h-4/)
    expect(el.className).toMatch(/w-full/)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })
})
