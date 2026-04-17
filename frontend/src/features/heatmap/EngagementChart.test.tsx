import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useHeatmapStore } from '../../store/heatmapStore'
import type { EventAnnotation, HeatmapDataPoint } from '../../types/twitch'
import { EngagementChart, formatTickMMSS } from './EngagementChart'

describe('EngagementChart', () => {
  beforeEach(() => {
    useHeatmapStore.getState().reset()
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
  })

  it('renders the empty-state placeholder when dataPoints is empty', () => {
    render(
      <div style={{ width: 600, height: 300 }}>
        <EngagementChart />
      </div>,
    )
    expect(screen.getByText('Waiting for chat…')).toBeInTheDocument()
  })

  it('renders a chart container (svg / responsive) when dataPoints are present', () => {
    const start = 1_700_000_000_000
    const dataPoints: HeatmapDataPoint[] = [
      { timestamp: start, msgPerSec: 1 },
      { timestamp: start + 1000, msgPerSec: 3 },
      { timestamp: start + 2000, msgPerSec: 5 },
      { timestamp: start + 3000, msgPerSec: 2 },
      { timestamp: start + 4000, msgPerSec: 7 },
    ]
    useHeatmapStore.setState({ dataPoints })

    const { container } = render(
      <div style={{ width: 600, height: 300 }}>
        <EngagementChart />
      </div>,
    )

    // Empty-state text should be gone once data is present.
    expect(screen.queryByText('Waiting for chat…')).not.toBeInTheDocument()

    const chartRoot =
      container.querySelector('.recharts-responsive-container') ??
      container.querySelector('svg')
    expect(chartRoot).not.toBeNull()
  })

  it('renders without throwing when annotations are provided alongside data points', () => {
    const start = 1_700_000_000_000
    const dataPoints: HeatmapDataPoint[] = [
      { timestamp: start, msgPerSec: 1 },
      { timestamp: start + 1000, msgPerSec: 4 },
      { timestamp: start + 2000, msgPerSec: 8 },
      { timestamp: start + 3000, msgPerSec: 6 },
    ]
    const annotations: EventAnnotation[] = [
      { timestamp: start + 1000, type: 'raid', label: 'Raid x50' },
      { timestamp: start + 2500, type: 'hype_train_begin', label: 'Hype train!' },
    ]
    useHeatmapStore.setState({ dataPoints, annotations })

    expect(() =>
      render(
        <div style={{ width: 600, height: 300 }}>
          <EngagementChart />
        </div>,
      ),
    ).not.toThrow()

    // Phase 5 Playwright will visually confirm the dashed ReferenceLine strokes;
    // happy-dom's SVG layout is too brittle to assert on <line stroke-dasharray>.
  })
})

describe('formatTickMMSS', () => {
  it('returns 00:00 when ts equals startMs', () => {
    expect(formatTickMMSS(1000, 1000)).toBe('00:00')
  })

  it('formats 65 seconds later as 01:05', () => {
    expect(formatTickMMSS(1000, 66000)).toBe('01:05')
  })

  it('returns 00:00 for zero elapsed at a non-zero startMs', () => {
    expect(formatTickMMSS(12345, 12345)).toBe('00:00')
  })

  it('formats the 10-minute boundary as 10:00', () => {
    expect(formatTickMMSS(0, 600_000)).toBe('10:00')
  })

  it('clamps negative elapsed (ts < startMs) to 00:00', () => {
    expect(formatTickMMSS(5_000, 1_000)).toBe('00:00')
  })

  it('zero-pads single-digit seconds', () => {
    expect(formatTickMMSS(0, 7_000)).toBe('00:07')
  })
})
