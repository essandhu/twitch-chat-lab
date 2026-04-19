import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Card } from './Card'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

describe('Card', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders in dark theme', () => {
    render(<Card data-testid="c">content</Card>)
    expect(screen.getByTestId('c')).toBeInTheDocument()
  })

  it('renders in light theme', () => {
    setTheme('light')
    render(<Card data-testid="c">content</Card>)
    expect(screen.getByTestId('c')).toBeInTheDocument()
  })

  it('defaults to bg-surface', () => {
    render(<Card data-testid="c">x</Card>)
    expect(screen.getByTestId('c').className).toMatch(/bg-surface(?!-)/)
  })

  it('elevated swaps to bg-surface-raised', () => {
    render(
      <Card elevated data-testid="c">
        x
      </Card>,
    )
    expect(screen.getByTestId('c').className).toMatch(/bg-surface-raised/)
  })

  it('forwards className + ref', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <Card ref={ref} className="x-extra" data-testid="c">
        x
      </Card>,
    )
    const el = screen.getByTestId('c')
    expect(el.className).toMatch(/x-extra/)
    expect(ref.current).toBeInstanceOf(HTMLDivElement)
  })

  it('renders Header, Body, Footer with distinct classes', () => {
    render(
      <Card>
        <Card.Header data-testid="h">H</Card.Header>
        <Card.Body data-testid="b">B</Card.Body>
        <Card.Footer data-testid="f">F</Card.Footer>
      </Card>,
    )
    expect(screen.getByTestId('h').className).toMatch(/border-b/)
    expect(screen.getByTestId('b').className).toMatch(/p-4/)
    expect(screen.getByTestId('f').className).toMatch(/border-t/)
    expect(screen.getByTestId('f').className).toMatch(/justify-end/)
  })
})
