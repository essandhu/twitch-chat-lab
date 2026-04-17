import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useHeatmapStore } from '../../store/heatmapStore'
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
})

describe('formatTickMMSS', () => {
  it('returns 00:00 when ts equals startMs', () => {
    expect(formatTickMMSS(1000, 1000)).toBe('00:00')
  })

  it('formats 65 seconds later as 01:05', () => {
    expect(formatTickMMSS(1000, 66000)).toBe('01:05')
  })
})
