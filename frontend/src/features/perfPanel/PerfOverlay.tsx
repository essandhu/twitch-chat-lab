import { MetricRow } from './MetricRow'
import { usePerfStore } from '../../store/perfStore'
import { usePerfMetrics } from '../../hooks/usePerfMetrics'
import { Card } from '../../components/ui/Card'

const HEAP_HINT =
  'performance.memory is a Chromium-only API. Firefox and Safari do not expose this metric.'

const formatHeap = (
  mb: number | null,
): { value: string; degraded: boolean; hint?: string } => {
  if (mb === null) return { value: 'n/a', degraded: false, hint: HEAP_HINT }
  return { value: `${mb.toFixed(1)} MB`, degraded: mb > 200 }
}

export const PerfOverlay = () => {
  const isVisible = usePerfStore((s) => s.isVisible)
  const metrics = usePerfStore((s) => s.metrics)
  usePerfMetrics(isVisible)

  if (!isVisible) return null

  const heap = formatHeap(metrics.jsHeapUsedMB)

  return (
    <Card
      elevated
      role="complementary"
      aria-label="Performance metrics"
      data-testid="perf-overlay"
      className="fixed bottom-4 right-4 z-[9999] w-64 backdrop-blur px-3 py-3 font-mono"
    >
      <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-text-muted">
        perf · live
      </div>
      <div className="flex flex-col gap-1">
        <MetricRow
          label="Render"
          value={`${metrics.messagesRenderedPerSec.toLocaleString('en-US')} msg/s`}
        />
        <MetricRow
          label="Virtualizer"
          value={`${metrics.virtualizerRenderMs.toFixed(1)} ms`}
          degraded={metrics.virtualizerRenderMs > 16}
        />
        <MetricRow
          label="DOM nodes"
          value={metrics.domNodeCount.toLocaleString('en-US')}
        />
        <MetricRow
          label="Heap"
          value={heap.value}
          degraded={heap.degraded}
          hint={heap.hint}
        />
        <MetricRow
          label="EventSub latency"
          value={`${metrics.eventSubLatencyMs.toFixed(0)} ms`}
          degraded={metrics.eventSubLatencyMs > 500}
        />
      </div>
    </Card>
  )
}
