import { useEffect, useRef } from 'react'
import { logger } from '../lib/logger'
import { readLatencySample } from '../services/EventSubLatencyChannel'
import { usePerfStore } from '../store/perfStore'

const POLL_MS = 500
const EMA_ALPHA = 0.2
const HEAP_DIVISOR = 1_048_576
const VIRT_MEASURE = 'virt'

type MemoryAware = { memory?: { usedJSHeapSize?: number } }

export const usePerfMetrics = (active = true) => {
  const emaRef = useRef(0)
  const ringRef = useRef<[number, number]>([0, 0])

  useEffect(() => {
    if (!active) return
    logger.debug('perf.metrics.started')

    const id = setInterval(() => {
      const now = performance.now()
      const entries = performance.getEntriesByName(VIRT_MEASURE, 'measure')
      const recent = entries.filter((e) => e.startTime >= now - POLL_MS)
      const tickCount = recent.length
      const virtualizerRenderMs =
        tickCount === 0 ? 0 : recent.reduce((s, e) => s + e.duration, 0) / tickCount
      performance.clearMeasures(VIRT_MEASURE)

      ringRef.current = [ringRef.current[1], tickCount]
      const messagesRenderedPerSec = ringRef.current[0] + ringRef.current[1]

      const heap = (performance as unknown as MemoryAware).memory?.usedJSHeapSize
      const jsHeapUsedMB =
        typeof heap === 'number' && Number.isFinite(heap) ? heap / HEAP_DIVISOR : null

      const sample = readLatencySample()
      if (sample !== null) {
        emaRef.current = EMA_ALPHA * sample + (1 - EMA_ALPHA) * emaRef.current
      }

      usePerfStore.getState().updateMetrics({
        domNodeCount: document.querySelectorAll('*').length,
        jsHeapUsedMB,
        virtualizerRenderMs,
        messagesRenderedPerSec,
        eventSubLatencyMs: emaRef.current,
      })
    }, POLL_MS)

    return () => {
      clearInterval(id)
      emaRef.current = 0
      ringRef.current = [0, 0]
    }
  }, [active])
}
