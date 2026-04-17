import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useHeatmapStore } from '../../store/heatmapStore'
import { HeatmapPanel } from './HeatmapPanel'

describe('HeatmapPanel', () => {
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

  it('renders Now label with current value formatted with grouping', () => {
    useHeatmapStore.setState({ currentMsgPerSec: 1234 })
    render(
      <div style={{ width: 600, height: 400 }}>
        <HeatmapPanel />
      </div>,
    )
    expect(screen.getByText('Now')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
  })

  it('renders Peak label with peak value formatted with grouping', () => {
    useHeatmapStore.setState({ peakMsgPerSec: 9876 })
    render(
      <div style={{ width: 600, height: 400 }}>
        <HeatmapPanel />
      </div>,
    )
    expect(screen.getByText('Peak')).toBeInTheDocument()
    expect(screen.getByText('9,876')).toBeInTheDocument()
  })

  it('peak card value has text-ember-400 accent class', () => {
    useHeatmapStore.setState({ peakMsgPerSec: 9876 })
    render(
      <div style={{ width: 600, height: 400 }}>
        <HeatmapPanel />
      </div>,
    )
    const peakValueEl = screen.getByText('9,876')
    expect(peakValueEl.className).toContain('text-ember-400')
  })

  it('shows the EngagementChart empty placeholder when no data points', () => {
    render(
      <div style={{ width: 600, height: 400 }}>
        <HeatmapPanel />
      </div>,
    )
    expect(screen.getByText('Waiting for chat…')).toBeInTheDocument()
  })
})
