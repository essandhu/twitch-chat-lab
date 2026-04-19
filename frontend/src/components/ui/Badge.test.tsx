import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Badge } from './Badge'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

describe('Badge', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders in dark theme as a span', () => {
    render(<Badge>hello</Badge>)
    const el = screen.getByText('hello')
    expect(el.tagName).toBe('SPAN')
  })

  it('renders in light theme', () => {
    setTheme('light')
    render(<Badge>hello</Badge>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('default variant applies muted surface class', () => {
    render(<Badge>x</Badge>)
    expect(screen.getByText('x').className).toMatch(/bg-surface-hover/)
  })

  it.each([
    ['accent', /bg-accent\/20/],
    ['success', /bg-success\/20/],
    ['danger', /bg-danger\/20/],
    ['warning', /bg-warning\/20/],
  ] as const)('variant %s applies expected token class', (variant, rx) => {
    render(<Badge variant={variant}>{variant}</Badge>)
    expect(screen.getByText(variant).className).toMatch(rx)
  })

  it('forwards className + ref', () => {
    const ref = React.createRef<HTMLSpanElement>()
    render(
      <Badge ref={ref} className="x-extra">
        y
      </Badge>,
    )
    expect(screen.getByText('y').className).toMatch(/x-extra/)
    expect(ref.current).toBeInstanceOf(HTMLSpanElement)
  })
})
