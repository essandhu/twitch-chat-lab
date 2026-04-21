import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import { useIntelligenceStore } from '../../store/intelligenceStore'
import { usePerfStore } from '../../store/perfStore'
import { PerfOverlay } from '../perfPanel/PerfOverlay'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { buildSyntheticBundle } from './syntheticChatGenerator'
import { installStoreTestHooks } from '../record/replayBoot'

const RATES = [100, 500, 1000, 5000] as const
type Rate = (typeof RATES)[number]
const DEFAULT_RATE: Rate = 1000
const TICK_MS = 16

const StressTestPageImpl = () => {
  const [rate, setRate] = useState<Rate>(DEFAULT_RATE)
  const [duration, setDuration] = useState<number>(10)
  const [running, setRunning] = useState(false)
  const [sent, setSent] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const seedRef = useRef(1)
  const startTimeRef = useRef(0)

  // Force perf overlay visible while on /stress; restore prior state on unmount.
  useEffect(() => {
    const prior = usePerfStore.getState().isVisible
    if (!prior) usePerfStore.setState({ isVisible: true })
    installStoreTestHooks()
    return () => {
      usePerfStore.setState({ isVisible: prior })
    }
  }, [])

  const stop = () => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRunning(false)
  }

  useEffect(() => () => stop(), [])

  const start = () => {
    if (running) return
    stop()
    setSent(0)
    seedRef.current = 1
    startTimeRef.current = Date.now()
    setRunning(true)

    const chat = useChatStore.getState()
    const intel = useIntelligenceStore.getState()
    // Time-based catchup: each tick dispatches enough messages to reach the
    // rate * elapsed target. Under browser event-loop pressure setInterval
    // callbacks can fire late and be coalesced — fixed per-tick batches would
    // undershoot. Unit tests with fake timers see the same logic.
    let sentLocal = 0
    let lastSync = 0
    const durationMs = duration * 1000
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current
      const capped = Math.min(elapsed, durationMs)
      const target = Math.floor((rate * capped) / 1000)
      const delta = target - sentLocal
      if (delta > 0) {
        const now = Date.now()
        for (let i = 0; i < delta; i++) {
          const { message, event } = buildSyntheticBundle(seedRef.current++, now)
          chat.addMessage(event)
          intel.ingestMessage(message)
        }
        sentLocal = target
      }
      if (elapsed >= durationMs) {
        setSent(sentLocal)
        stop()
        return
      }
      // Throttle React state sync to ~10Hz to avoid per-tick rerender storms.
      if (elapsed - lastSync >= 100) {
        lastSync = elapsed
        setSent(sentLocal)
      }
    }, TICK_MS)
  }

  return (
    <div data-testid="stress-page" className="flex min-h-screen flex-col gap-4 bg-bg p-6 text-text">
      <h1 className="font-mono text-sm uppercase tracking-[0.3em] text-text-muted">
        Stress Test (dev only)
      </h1>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-[0.2em] text-text-muted">Rate (msg/s)</span>
          <Select
            data-testid="stress-rate-select"
            value={String(rate)}
            onChange={(e) => setRate(Number(e.target.value) as Rate)}
            disabled={running}
            className="w-32"
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="uppercase tracking-[0.2em] text-text-muted">Duration (s)</span>
          <input
            data-testid="stress-duration"
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(Math.max(1, Number(e.target.value) || 1))}
            disabled={running}
            className="h-9 w-24 rounded-md border border-border bg-surface px-3 text-sm"
          />
        </label>
        <Button data-testid="stress-start" onClick={start} disabled={running}>
          Start
        </Button>
        <Button data-testid="stress-stop" onClick={stop} disabled={!running}>
          Stop
        </Button>
        <div data-testid="stress-sent" className="font-mono text-xs text-text-muted">
          sent: {sent.toLocaleString('en-US')}
        </div>
      </div>
      <PerfOverlay />
    </div>
  )
}

export const StressTestPage = () => {
  if (!import.meta.env.DEV) return <div data-testid="stress-not-found">Not Found</div>
  return <StressTestPageImpl />
}
