import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHeatmapStore } from '../../store/heatmapStore'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import type { EventAnnotation, HeatmapDataPoint } from '../../types/twitch'
import {
  AXIS_LABEL_MSG_PER_SEC,
  AXIS_LABEL_TIME,
  ChartTooltip,
  EngagementChart,
  formatTickMMSS,
} from './EngagementChart'

// Recharts' ResponsiveContainer measures the DOM for width/height. happy-dom
// reports 0×0 so the chart body never renders, making DOM-level assertions on
// <Line>/<Legend>/<ReferenceLine> impossible in multi-mode. Mock Recharts with
// lightweight shims that mirror the production DOM structure enough for
// us to assert on <Line> count, palette strokes, Legend names, and annotation
// labels. Single-mode tests below do NOT depend on this mock — they only
// assert on the presence of `.recharts-responsive-container` / empty-state
// text, which remain satisfied because our stubbed ResponsiveContainer emits
// that class name.
vi.mock('recharts', () => {
  const ResponsiveContainer = ({ children }: { children: ReactNode }) => (
    <div
      className="recharts-responsive-container"
      style={{ width: 600, height: 300 }}
    >
      {children}
    </div>
  )
  // Each Line renders a <path> AND a <text> sibling carrying its name, so that
  // a top-level screen.getByText(name) resolves to Recharts' Legend-equivalent
  // DOM. In real Recharts, the Legend is a separate component that reads
  // series metadata from chart context; replicating that context wiring inside
  // a mock is brittle, so we co-locate the name label with the Line path.
  const Line = ({ stroke, name }: { stroke?: string; name?: string }) => (
    <>
      <path
        className="recharts-line-curve"
        data-name={name}
        stroke={stroke}
        fill="none"
      />
      {name ? (
        <text className="recharts-legend-item-text">{name}</text>
      ) : null}
    </>
  )
  const LineChart = ({ children }: { children?: ReactNode }) => (
    <svg className="recharts-surface" width={600} height={300}>
      {children}
    </svg>
  )
  const Legend = () => <div className="recharts-legend-wrapper" data-testid="legend" />
  // Tooltip renders nothing at rest; the real component only shows on hover,
  // which happy-dom can't simulate reliably. Our production tooltip is asserted
  // indirectly via ChartTooltip unit tests if they exist; here we just need the
  // import to resolve to a renderable React node so EngagementChart mounts.
  const Tooltip = () => null

  const XAxis = () => null
  const YAxis = () => null
  const ReferenceLine = ({
    label,
  }: {
    x?: number
    label?: { value: string } | string
  }) => {
    const text =
      typeof label === 'string' ? label : (label?.value ?? '')
    return <text className="recharts-reference-line-label">{text}</text>
  }
  return {
    ResponsiveContainer,
    LineChart,
    Line,
    Legend,
    Tooltip,
    XAxis,
    YAxis,
    ReferenceLine,
  }
})

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

describe('EngagementChart — multi-stream mode', () => {
  const palette = [
    'rgb(var(--accent))',
    'rgb(var(--success))',
    'rgb(var(--warning))',
  ]

  const seedMultiMode = (slices: Array<{ login: string; displayName: string }>): void => {
    const store = useMultiStreamStore.getState()
    store.reset()
    for (const slice of slices) {
      store.addStream({
        login: slice.login,
        displayName: slice.displayName,
        broadcasterId: `b_${slice.login}`,
      })
    }
    useMultiStreamStore.getState().setActive(true)
  }

  const seedDataPoints = (login: string, count: number, startMs: number): void => {
    const dataPoints: HeatmapDataPoint[] = Array.from({ length: count }, (_, i) => ({
      timestamp: startMs + i * 1000,
      msgPerSec: 1 + i,
    }))
    useMultiStreamStore.setState((state) => ({
      streams: {
        ...state.streams,
        [login]: { ...state.streams[login]!, dataPoints },
      },
    }))
  }

  const seedAnnotations = (login: string, annotations: EventAnnotation[]): void => {
    useMultiStreamStore.setState((state) => ({
      streams: {
        ...state.streams,
        [login]: { ...state.streams[login]!, annotations },
      },
    }))
  }

  beforeEach(() => {
    useHeatmapStore.getState().reset()
    useMultiStreamStore.getState().reset()
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver
    }
  })

  afterEach(() => {
    useMultiStreamStore.getState().reset()
  })

  it('renders one <Line> per stream using the rotated palette', () => {
    const start = 1_700_000_000_000
    seedMultiMode([
      { login: 'alice', displayName: 'Alice' },
      { login: 'bob', displayName: 'Bob' },
      { login: 'carol', displayName: 'Carol' },
    ])
    seedDataPoints('alice', 4, start)
    seedDataPoints('bob', 4, start)
    seedDataPoints('carol', 4, start)

    const { container } = render(
      <div style={{ width: 600, height: 300 }}>
        <EngagementChart />
      </div>,
    )

    const lines = container.querySelectorAll('path.recharts-line-curve')
    expect(lines.length).toBe(3)
    // Each line gets the palette token in order (rotated via modulo).
    const strokes = Array.from(lines).map((el) => el.getAttribute('stroke'))
    expect(strokes).toEqual(palette.slice(0, 3))
  })

  it('renders a Legend with the stream display names in multi mode', () => {
    const start = 1_700_000_000_000
    seedMultiMode([
      { login: 'alice', displayName: 'Alice' },
      { login: 'bob', displayName: 'Bob' },
    ])
    seedDataPoints('alice', 3, start)
    seedDataPoints('bob', 3, start)

    render(
      <div style={{ width: 600, height: 300 }}>
        <EngagementChart />
      </div>,
    )

    // Legend component is present.
    expect(screen.getByTestId('legend')).toBeInTheDocument()
    // Series names are rendered via the Line `name` prop, visible in the DOM.
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('prefixes annotations with the stream display name in multi mode', () => {
    const start = 1_700_000_000_000
    seedMultiMode([
      { login: 'alice', displayName: 'Alice' },
      { login: 'bob', displayName: 'Bob' },
    ])
    seedDataPoints('alice', 4, start)
    seedDataPoints('bob', 4, start)
    seedAnnotations('alice', [
      { timestamp: start + 1000, type: 'raid', label: 'Raid x50' },
    ])
    seedAnnotations('bob', [
      { timestamp: start + 2000, type: 'hype_train_begin', label: 'Hype train!' },
    ])

    render(
      <div style={{ width: 600, height: 300 }}>
        <EngagementChart />
      </div>,
    )

    // ReferenceLine labels are rendered as SVG text; assert via text-content matcher.
    expect(screen.getByText((content) => /Alice\s·\sRaid x50/.test(content))).toBeInTheDocument()
    expect(
      screen.getByText((content) => /Bob\s·\sHype train!/.test(content)),
    ).toBeInTheDocument()
  })
})

describe('EngagementChart — token-driven chart colors', () => {
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

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  const seedSingleMode = (): void => {
    const start = 1_700_000_000_000
    const dataPoints: HeatmapDataPoint[] = [
      { timestamp: start, msgPerSec: 1 },
      { timestamp: start + 1000, msgPerSec: 3 },
      { timestamp: start + 2000, msgPerSec: 5 },
    ]
    useHeatmapStore.setState({ dataPoints })
  }

  it('uses rgb(var(--accent)) for the primary stroke in dark mode', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    seedSingleMode()
    const { container } = render(
      <div style={{ width: 600, height: 300 }}>
        <EngagementChart />
      </div>,
    )
    const line = container.querySelector('path.recharts-line-curve')
    expect(line).not.toBeNull()
    expect(line!.getAttribute('stroke')).toBe('rgb(var(--accent))')
  })

  it('uses rgb(var(--accent)) for the primary stroke in light mode', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    seedSingleMode()
    const { container } = render(
      <div style={{ width: 600, height: 300 }}>
        <EngagementChart />
      </div>,
    )
    const line = container.querySelector('path.recharts-line-curve')
    expect(line).not.toBeNull()
    // tokenRgb() emits the same CSS-variable string regardless of theme; the
    // browser resolves the variable per the active data-theme.
    expect(line!.getAttribute('stroke')).toBe('rgb(var(--accent))')
  })
})

describe('ChartTooltip', () => {
  const startMs = 1_700_000_000_000

  it('returns null when inactive', () => {
    const { container } = render(
      <ChartTooltip
        active={false}
        payload={[{ value: 5, name: 'Alice', color: '#abc' }]}
        label={startMs + 1000}
        startMs={startMs}
        showSeriesName
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('returns null when payload is empty', () => {
    const { container } = render(
      <ChartTooltip
        active
        payload={[]}
        label={startMs + 1000}
        startMs={startMs}
        showSeriesName
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders timestamp header and msg/s value with color swatch', () => {
    const { container, getByRole } = render(
      <ChartTooltip
        active
        payload={[{ value: 42, name: 'Alice', color: 'rgb(1,2,3)' }]}
        label={startMs + 65_000}
        startMs={startMs}
        showSeriesName={false}
      />,
    )
    const tooltip = getByRole('tooltip')
    expect(tooltip).toHaveTextContent('01:05')
    expect(tooltip).toHaveTextContent('42 msg/s')
    const swatch = container.querySelector('span[aria-hidden]')
    expect(swatch).not.toBeNull()
    expect((swatch as HTMLElement).style.backgroundColor).toBe('rgb(1, 2, 3)')
  })

  it('omits series name in single mode and includes it in multi mode', () => {
    const single = render(
      <ChartTooltip
        active
        payload={[{ value: 3, name: 'Messages / second', color: '#abc' }]}
        label={startMs}
        startMs={startMs}
        showSeriesName={false}
      />,
    )
    expect(single.queryByText('Messages / second:')).toBeNull()
    single.unmount()

    const multi = render(
      <ChartTooltip
        active
        payload={[{ value: 3, name: 'Alice', color: '#abc' }]}
        label={startMs}
        startMs={startMs}
        showSeriesName
      />,
    )
    expect(multi.getByText('Alice:')).toBeInTheDocument()
  })
})

describe('EngagementChart axis labels', () => {
  it('exposes the expected axis label strings', () => {
    expect(AXIS_LABEL_TIME).toBe('Time (mm:ss)')
    expect(AXIS_LABEL_MSG_PER_SEC).toBe('Messages / second')
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
