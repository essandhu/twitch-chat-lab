import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MetricRow } from './MetricRow'

describe('MetricRow', () => {
  it('renders label and value text', () => {
    render(<MetricRow label="FPS" value="60" />)
    expect(screen.getByText('FPS')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
  })

  it('default: value has text-ink-100 and NOT text-ember-400', () => {
    render(<MetricRow label="FPS" value="60" />)
    const valueEl = screen.getByText('60')
    expect(valueEl.className).toContain('text-ink-100')
    expect(valueEl.className).not.toContain('text-ember-400')
  })

  it('degraded=true: value has text-ember-400 and NOT text-ink-100', () => {
    render(<MetricRow label="FPS" value="28" degraded />)
    const valueEl = screen.getByText('28')
    expect(valueEl.className).toContain('text-ember-400')
    expect(valueEl.className).not.toContain('text-ink-100')
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
