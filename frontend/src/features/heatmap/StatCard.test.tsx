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

  it('default accent: value has text-ink-100 and NOT text-ember-400', () => {
    render(<StatCard label="Now" value="99" />)
    const valueEl = screen.getByText('99')
    expect(valueEl.className).toContain('text-ink-100')
    expect(valueEl.className).not.toContain('text-ember-400')
  })

  it('peak accent: value has text-ember-400', () => {
    render(<StatCard label="Peak" value="500" accent="peak" />)
    const valueEl = screen.getByText('500')
    expect(valueEl.className).toContain('text-ember-400')
  })

  it('surface wrapper has border, border-ink-800 and bg-ink-900/40 classes', () => {
    const { container } = render(<StatCard label="Now" value="1" />)
    const surface = container.firstChild as HTMLElement
    expect(surface.className).toContain('border')
    expect(surface.className).toContain('border-ink-800')
    expect(surface.className).toContain('bg-ink-900/40')
  })

  it('is wrapped in React.memo (structural check)', () => {
    expect((StatCard as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    )
  })
})
