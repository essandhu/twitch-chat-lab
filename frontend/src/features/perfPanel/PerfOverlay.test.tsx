import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerfOverlay } from './PerfOverlay'
import { usePerfStore } from '../../store/perfStore'

const HEAP_HINT =
  'performance.memory is a Chromium-only API. Firefox and Safari do not expose this metric.'

describe('PerfOverlay', () => {
  beforeEach(() => {
    usePerfStore.getState().reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when hidden (default isVisible=false)', () => {
    const { container } = render(<PerfOverlay />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('renders aside with aria-label when visible', () => {
    usePerfStore.setState({ isVisible: true })
    render(<PerfOverlay />)
    const aside = screen.getByRole('complementary', { name: 'Performance metrics' })
    expect(aside).toBeInTheDocument()
  })

  it('heap row shows "n/a" with hint when jsHeapUsedMB is null', () => {
    usePerfStore.setState({ isVisible: true })
    render(<PerfOverlay />)
    expect(screen.getByText('n/a')).toBeInTheDocument()
    expect(screen.getByTitle(HEAP_HINT)).toBeInTheDocument()
  })

  it('heap value is degraded (text-ember-400) when jsHeapUsedMB > 200', () => {
    usePerfStore.setState({
      isVisible: true,
      metrics: {
        messagesRenderedPerSec: 0,
        domNodeCount: 0,
        jsHeapUsedMB: 250,
        eventSubLatencyMs: 0,
        virtualizerRenderMs: 0,
      },
    })
    render(<PerfOverlay />)
    const heapValue = screen.getByText('250.0 MB')
    expect(heapValue.className).toContain('text-ember-400')
  })

  it('virtualizer value is degraded (text-ember-400) when virtualizerRenderMs > 16', () => {
    usePerfStore.setState({
      isVisible: true,
      metrics: {
        messagesRenderedPerSec: 0,
        domNodeCount: 0,
        jsHeapUsedMB: null,
        eventSubLatencyMs: 0,
        virtualizerRenderMs: 20,
      },
    })
    render(<PerfOverlay />)
    const virtValue = screen.getByText('20.0 ms')
    expect(virtValue.className).toContain('text-ember-400')
  })

  it('latency NOT degraded at 400ms (threshold is > 500)', () => {
    usePerfStore.setState({
      isVisible: true,
      metrics: {
        messagesRenderedPerSec: 0,
        domNodeCount: 0,
        jsHeapUsedMB: null,
        eventSubLatencyMs: 400,
        virtualizerRenderMs: 0,
      },
    })
    render(<PerfOverlay />)
    const latencyValue = screen.getByText('400 ms')
    expect(latencyValue.className).toContain('text-ink-100')
    expect(latencyValue.className).not.toContain('text-ember-400')
  })

  it('renders five MetricRows when visible', () => {
    usePerfStore.setState({ isVisible: true })
    const { container } = render(<PerfOverlay />)
    const rows = container.querySelectorAll('aside > div:nth-child(2) > div')
    expect(rows.length).toBe(5)
  })

  it('formats metrics per row spec (locale + toFixed)', () => {
    usePerfStore.setState({
      isVisible: true,
      metrics: {
        messagesRenderedPerSec: 12345,
        domNodeCount: 6789,
        jsHeapUsedMB: 123.456,
        eventSubLatencyMs: 42.7,
        virtualizerRenderMs: 8.25,
      },
    })
    render(<PerfOverlay />)
    expect(screen.getByText('12,345 msg/s')).toBeInTheDocument()
    expect(screen.getByText('8.3 ms')).toBeInTheDocument()
    expect(screen.getByText('6,789')).toBeInTheDocument()
    expect(screen.getByText('123.5 MB')).toBeInTheDocument()
    expect(screen.getByText('43 ms')).toBeInTheDocument()
  })
})
