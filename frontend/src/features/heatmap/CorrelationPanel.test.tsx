import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { pairKeyFor, useMultiStreamStore } from '../../store/multiStreamStore'
import {
  AXIS_LABEL_CORRELATION,
  AXIS_LABEL_TIME,
  CorrelationPanel,
  CorrelationTooltip,
} from './CorrelationPanel'

const seed = (login: string): void => {
  useMultiStreamStore.getState().addStream({
    login,
    displayName: login.toUpperCase(),
    broadcasterId: `b_${login}`,
  })
}

describe('CorrelationPanel', () => {
  beforeEach(() => {
    useMultiStreamStore.getState().reset()
  })

  it('renders null when not active', () => {
    seed('a')
    seed('b')
    const { container } = render(<CorrelationPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when less than 2 streams', () => {
    seed('a')
    useMultiStreamStore.setState({ isActive: true })
    const { container } = render(<CorrelationPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders chart container when active with >=2 streams', () => {
    seed('alpha')
    seed('beta')
    useMultiStreamStore.setState({
      isActive: true,
      correlation: {
        [pairKeyFor('alpha', 'beta')]: { coefficient: 0.77, lagMs: 2000, updatedAt: Date.now() },
      },
    })
    render(<CorrelationPanel />)
    expect(screen.getByTestId('correlation-chart')).toBeInTheDocument()
  })

  it('handles NaN coefficient without crashing', () => {
    seed('alpha')
    seed('beta')
    useMultiStreamStore.setState({
      isActive: true,
      correlation: {
        [pairKeyFor('alpha', 'beta')]: {
          coefficient: Number.NaN,
          lagMs: 0,
          updatedAt: Date.now(),
        },
      },
    })
    render(<CorrelationPanel />)
    expect(screen.getByTestId('correlation-chart')).toBeInTheDocument()
  })
})

describe('CorrelationTooltip', () => {
  const startMs = 1_700_000_000_000

  it('returns null when inactive', () => {
    const { container } = render(
      <CorrelationTooltip
        active={false}
        payload={[{ value: 0.5, name: 'alpha|beta', color: '#abc', payload: { t: startMs, r: 0.5, lagMs: 1000 } }]}
        label={startMs + 1000}
        startMs={startMs}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('returns null when payload is empty', () => {
    const { container } = render(
      <CorrelationTooltip active payload={[]} label={startMs + 1000} startMs={startMs} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders timestamp header, pair name, r, and lag with color swatch', () => {
    const { container, getByRole } = render(
      <CorrelationTooltip
        active
        payload={[
          {
            value: 0.77,
            name: 'alpha|beta',
            color: 'rgb(1,2,3)',
            payload: { t: startMs + 65_000, r: 0.77, lagMs: 2000 },
          },
        ]}
        label={startMs + 65_000}
        startMs={startMs}
      />,
    )
    const tooltip = getByRole('tooltip')
    expect(tooltip).toHaveTextContent('01:05')
    expect(tooltip).toHaveTextContent('alpha|beta:')
    expect(tooltip).toHaveTextContent('r=0.77')
    expect(tooltip).toHaveTextContent('lag=2000ms')
    const swatch = container.querySelector('span[aria-hidden]')
    expect(swatch).not.toBeNull()
    expect((swatch as HTMLElement).style.backgroundColor).toBe('rgb(1, 2, 3)')
  })

  it("shows 'n/a' for NaN coefficient without crashing", () => {
    const { getByRole } = render(
      <CorrelationTooltip
        active
        payload={[
          {
            value: Number.NaN,
            name: 'alpha|beta',
            color: '#abc',
            payload: { t: startMs, r: Number.NaN, lagMs: 0 },
          },
        ]}
        label={startMs}
        startMs={startMs}
      />,
    )
    const tooltip = getByRole('tooltip')
    expect(tooltip).toHaveTextContent('r=n/a')
    expect(tooltip).toHaveTextContent('lag=0ms')
  })

  it('renders one row per pair when multiple series are hovered', () => {
    const { container } = render(
      <CorrelationTooltip
        active
        payload={[
          { value: 0.5, name: 'a|b', color: '#111', payload: { t: startMs, r: 0.5, lagMs: 100 } },
          { value: -0.3, name: 'a|c', color: '#222', payload: { t: startMs, r: -0.3, lagMs: 250 } },
        ]}
        label={startMs}
        startMs={startMs}
      />,
    )
    const swatches = container.querySelectorAll('span[aria-hidden]')
    expect(swatches.length).toBe(2)
  })
})

describe('CorrelationPanel axis labels', () => {
  it('exposes the expected axis label strings', () => {
    expect(AXIS_LABEL_TIME).toBe('Time (mm:ss)')
    expect(AXIS_LABEL_CORRELATION).toBe('Correlation (r)')
  })
})
