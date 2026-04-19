import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatCard } from './StatCard'

describe('StatCard', () => {
  it('renders the label text', () => {
    render(<StatCard label="Now" value={42} />)
    expect(screen.getByText('Now')).toBeInTheDocument()
  })

  it('renders a numeric value', () => {
    render(<StatCard label="Now" value={123} />)
    expect(screen.getByText('123')).toBeInTheDocument()
  })

  it('renders a string value', () => {
    render(<StatCard label="Peak" value="1,234" />)
    expect(screen.getByText('1,234')).toBeInTheDocument()
  })

  it('default accent: value has text-text and NOT text-accent', () => {
    render(<StatCard label="Now" value="99" />)
    const valueEl = screen.getByText('99')
    expect(valueEl.className).toContain('text-text')
    expect(valueEl.className).not.toContain('text-accent')
  })

  it('peak accent: value has text-accent', () => {
    render(<StatCard label="Peak" value="500" accent="peak" />)
    const valueEl = screen.getByText('500')
    expect(valueEl.className).toContain('text-accent')
  })

  it('surface wrapper has border, border-border and bg-surface classes', () => {
    const { container } = render(<StatCard label="Now" value="1" />)
    const surface = container.firstChild as HTMLElement
    expect(surface.className).toContain('border')
    expect(surface.className).toContain('border-border')
    expect(surface.className).toContain('bg-surface')
  })

  it('is wrapped in React.memo (structural check)', () => {
    expect((StatCard as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    )
  })
})
