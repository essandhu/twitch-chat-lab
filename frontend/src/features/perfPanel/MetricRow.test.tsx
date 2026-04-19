import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricRow } from './MetricRow'

describe('MetricRow', () => {
  it('renders label and value text', () => {
    render(<MetricRow label="FPS" value="60" />)
    expect(screen.getByText('FPS')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
  })

  it('default: value has text-text and NOT text-warning', () => {
    render(<MetricRow label="FPS" value="60" />)
    const valueEl = screen.getByText('60')
    expect(valueEl.className).toContain('text-text')
    expect(valueEl.className).not.toContain('text-warning')
  })

  it('degraded=true: value has text-warning and NOT text-text (base)', () => {
    render(<MetricRow label="FPS" value="28" degraded />)
    const valueEl = screen.getByText('28')
    expect(valueEl.className).toContain('text-warning')
    // Use split/includes to ensure the non-warning `text-text` class is not
    // also present (substring match would falsely pass via text-text-muted).
    expect(valueEl.className.split(/\s+/)).not.toContain('text-text')
  })

  it('hint provided: label is wrapped in element with title and aria-label', () => {
    const hint = 'Not supported in Firefox/Safari'
    render(<MetricRow label="Heap" value="n/a" hint={hint} />)
    const labelEl = screen.getByTitle(hint)
    expect(labelEl).toBeInTheDocument()
    expect(labelEl).toHaveAttribute('aria-label', hint)
    expect(labelEl).toHaveTextContent('Heap')
  })

  it('no hint: label is not wrapped with title attribute', () => {
    render(<MetricRow label="FPS" value="60" />)
    expect(screen.queryByTitle('FPS')).not.toBeInTheDocument()
  })

  it('is wrapped in React.memo (structural check)', () => {
    expect((MetricRow as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    )
  })
})
