import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionReplayer } from './SessionReplayer'
import { SCHEMA_VERSION } from '../types/recording'
import type { RecordedFrame, RecordingHeader } from '../types/twitch'

interface FakeManager {
  dispatched: RecordedFrame[]
  dispatchFrame: (frame: RecordedFrame) => void
}

const createFakeManager = (): FakeManager => {
  const dispatched: RecordedFrame[] = []
  return {
    dispatched,
    dispatchFrame: (frame) => {
      dispatched.push(frame)
    },
  }
}

const makeBlob = (header: RecordingHeader, frames: RecordedFrame[]): Blob => {
  const lines = [JSON.stringify(header), ...frames.map((f) => JSON.stringify(f))]
  return new Blob([lines.join('\n')], { type: 'application/x-ndjson' })
}

const validHeader: RecordingHeader = {
  schemaVersion: SCHEMA_VERSION,
  recordedAt: '2025-11-15T19:00:00.000Z',
  recorderVersion: '0.11.0',
}

const buildFrames = (streamLogin: string, times: number[]): RecordedFrame[] =>
  times.map((t, i) => ({
    t: new Date(t).toISOString(),
    kind: 'notification',
    streamLogin,
    payload: { index: i, streamLogin },
  }))

describe('SessionReplayer.load', () => {
  it('parses a valid JSONL fixture and reports header, frameCount, duration, streamLogins', async () => {
    const frames = buildFrames('shroud', [1000, 2000, 5000])
    const blob = makeBlob(validHeader, frames)
    const replayer = new SessionReplayer(createFakeManager())
    const info = await replayer.load(blob)
    expect(info.header.schemaVersion).toBe(1)
    expect(info.frameCount).toBe(3)
    expect(info.duration).toBe(4000)
    expect(info.streamLogins).toEqual(['shroud'])
  })

  it('throws RecorderSchemaError with code unknown-schema-version on wrong schemaVersion', async () => {
    const bad = { ...validHeader, schemaVersion: 99 } as unknown as RecordingHeader
    const blob = makeBlob(bad, buildFrames('shroud', [1000]))
    const replayer = new SessionReplayer(createFakeManager())
    await expect(replayer.load(blob)).rejects.toMatchObject({
      name: 'RecorderSchemaError',
      code: 'unknown-schema-version',
    })
  })

  it('throws RecorderSchemaError with code malformed-header on non-JSON header', async () => {
    const blob = new Blob(['not-json\n{"t":"x"}'], { type: 'application/x-ndjson' })
    const replayer = new SessionReplayer(createFakeManager())
    await expect(replayer.load(blob)).rejects.toMatchObject({
      name: 'RecorderSchemaError',
      code: 'malformed-header',
    })
  })

  it('throws RecorderSchemaError with code malformed-frame on non-JSON frame line', async () => {
    const blob = new Blob([JSON.stringify(validHeader) + '\n' + '{bad-json'], {
      type: 'application/x-ndjson',
    })
    const replayer = new SessionReplayer(createFakeManager())
    await expect(replayer.load(blob)).rejects.toMatchObject({
      name: 'RecorderSchemaError',
      code: 'malformed-frame',
    })
  })

  it('throws RecorderSchemaError with code empty-recording when there are no frames', async () => {
    const blob = makeBlob(validHeader, [])
    const replayer = new SessionReplayer(createFakeManager())
    await expect(replayer.load(blob)).rejects.toMatchObject({
      name: 'RecorderSchemaError',
      code: 'empty-recording',
    })
  })

  it('groups frames by streamLogin and reports each login once', async () => {
    const frames = [
      ...buildFrames('a', [1000, 3000]),
      ...buildFrames('b', [2000, 4000]),
      ...buildFrames('c', [2500]),
    ]
    const blob = makeBlob(validHeader, frames)
    const replayer = new SessionReplayer(createFakeManager())
    const info = await replayer.load(blob)
    expect(info.streamLogins.sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('SessionReplayer.play / pause / speed', () => {
  let manager: FakeManager
  let replayer: SessionReplayer

  beforeEach(async () => {
    vi.useFakeTimers()
    manager = createFakeManager()
    replayer = new SessionReplayer(manager)
    const frames = buildFrames('shroud', [1000, 2000, 3000, 4000])
    await replayer.load(makeBlob(validHeader, frames))
  })

  afterEach(() => {
    replayer.dispose()
    vi.useRealTimers()
  })

  it('play dispatches the first frame immediately (offset 0) and subsequent frames on the setTimeout schedule', async () => {
    replayer.play()
    // first frame dispatches on first scheduler tick — advance by 0 to let microtask + 0ms timeout flush
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.dispatched).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(manager.dispatched).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(manager.dispatched).toHaveLength(4)
  })

  it('setSpeed(2) halves inter-frame delays', async () => {
    replayer.setSpeed(2)
    replayer.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.dispatched).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(manager.dispatched).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(manager.dispatched).toHaveLength(3)
  })

  it('setSpeed(5) — five-fold faster replay', async () => {
    replayer.setSpeed(5)
    replayer.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.dispatched).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(manager.dispatched).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(manager.dispatched).toHaveLength(3)
  })

  it('setSpeed(0.5) doubles inter-frame delays', async () => {
    replayer.setSpeed(0.5)
    replayer.play()
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.dispatched).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(manager.dispatched).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(manager.dispatched).toHaveLength(2)
  })

  it('pause halts dispatch; subsequent play resumes from position', async () => {
    replayer.play()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(manager.dispatched).toHaveLength(2)
    replayer.pause()
    const posAtPause = replayer.getPosition()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(manager.dispatched).toHaveLength(2)
    expect(replayer.getPosition()).toBe(posAtPause)
    replayer.play()
    await vi.advanceTimersByTimeAsync(1000)
    expect(manager.dispatched).toHaveLength(3)
  })
})

describe('SessionReplayer.seekTo', () => {
  let manager: FakeManager
  let replayer: SessionReplayer
  let resetCount = 0

  beforeEach(async () => {
    vi.useFakeTimers()
    manager = createFakeManager()
    resetCount = 0
    replayer = new SessionReplayer(manager, {
      onReset: () => {
        resetCount += 1
        manager.dispatched.length = 0
      },
    })
    const frames = buildFrames('shroud', [1000, 5000, 15000, 25000, 30000])
    await replayer.load(makeBlob(validHeader, frames))
  })

  afterEach(() => {
    replayer.dispose()
    vi.useRealTimers()
  })

  it('seekTo(15000) dispatches frames with relative t ≤ 15000 and leaves remainder pending', () => {
    replayer.seekTo(15000)
    expect(manager.dispatched).toHaveLength(3)
    expect(manager.dispatched.map((f) => Date.parse(f.t) - 1000)).toEqual([0, 4000, 14000])
  })

  it('seekTo sets getPosition to the requested offset', () => {
    replayer.seekTo(14000)
    expect(replayer.getPosition()).toBe(14000)
  })

  it('seekTo within 500ms of the target — all dispatched frames have rel ≤ requested', () => {
    replayer.seekTo(14500)
    const nextFrames = manager.dispatched.slice()
    // Fixture frames at rel [0, 4000, 14000, 24000, 29000] — 3 are ≤ 14500
    expect(nextFrames).toHaveLength(3)
    for (const f of nextFrames) {
      expect(Date.parse(f.t) - 1000).toBeLessThanOrEqual(14500)
    }
  })

  it('seekTo backwards invokes onReset and re-dispatches from origin', () => {
    // frames rel [0, 4000, 14000, 24000, 29000]; seekTo(20000) → 3 dispatched
    replayer.seekTo(20000)
    expect(manager.dispatched).toHaveLength(3)
    expect(resetCount).toBe(0)
    replayer.seekTo(5000)
    expect(resetCount).toBe(1)
    // After reset, re-dispatched 2 (rel ≤ 5000: 0, 4000)
    expect(manager.dispatched).toHaveLength(2)
  })

  it('multi-stream seekTo — every per-stream deque advances past its own t ≤ requested', async () => {
    const mgr = createFakeManager()
    const rp = new SessionReplayer(mgr)
    const frames: RecordedFrame[] = [
      ...buildFrames('a', [1000, 5000, 20000]),
      ...buildFrames('b', [1500, 15000, 25000]),
      ...buildFrames('c', [10000, 17000, 30000]),
    ]
    frames.sort((x, y) => Date.parse(x.t) - Date.parse(y.t))
    await rp.load(makeBlob(validHeader, frames))
    // firstT = 1000. seekTo(15000) → frames with tEpoch - 1000 ≤ 15000 (tEpoch ≤ 16000)
    // a: [1000, 5000, 20000] → 1000, 5000 → 2
    // b: [1500, 15000, 25000] → 1500, 15000 → 2
    // c: [10000, 17000, 30000] → 10000 → 1 (17000 > 16000)
    rp.seekTo(15000)
    const dispatchedPerLogin = new Map<string, number>()
    for (const f of mgr.dispatched) {
      dispatchedPerLogin.set(f.streamLogin, (dispatchedPerLogin.get(f.streamLogin) ?? 0) + 1)
    }
    expect(dispatchedPerLogin.get('a')).toBe(2)
    expect(dispatchedPerLogin.get('b')).toBe(2)
    expect(dispatchedPerLogin.get('c')).toBe(1)
    rp.dispose()
  })
})

describe('SessionReplayer.onPositionChange', () => {
  it('fires on play and on pause with the current position', async () => {
    vi.useFakeTimers()
    try {
      const manager = createFakeManager()
      const replayer = new SessionReplayer(manager)
      const frames = buildFrames('shroud', [1000, 2000, 3000])
      await replayer.load(makeBlob(validHeader, frames))
      const positions: number[] = []
      const unsub = replayer.onPositionChange((p) => positions.push(p))
      replayer.play()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)
      replayer.pause()
      expect(positions.length).toBeGreaterThan(0)
      expect(positions[positions.length - 1]).toBeGreaterThanOrEqual(500)
      unsub()
      replayer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('onPositionChange returns an unsubscribe fn that stops further notifications', async () => {
    vi.useFakeTimers()
    try {
      const manager = createFakeManager()
      const replayer = new SessionReplayer(manager)
      const frames = buildFrames('shroud', [1000, 2000, 3000])
      await replayer.load(makeBlob(validHeader, frames))
      const positions: number[] = []
      const unsub = replayer.onPositionChange((p) => positions.push(p))
      unsub()
      replayer.seekTo(2500)
      expect(positions).toHaveLength(0)
      replayer.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('SessionReplayer.dispose', () => {
  it('dispose clears pending timers and is safe to call multiple times', async () => {
    vi.useFakeTimers()
    try {
      const manager = createFakeManager()
      const replayer = new SessionReplayer(manager)
      const frames = buildFrames('shroud', [1000, 2000, 3000])
      await replayer.load(makeBlob(validHeader, frames))
      replayer.play()
      await vi.advanceTimersByTimeAsync(0)
      replayer.dispose()
      replayer.dispose() // idempotent
      const before = manager.dispatched.length
      await vi.advanceTimersByTimeAsync(10_000)
      expect(manager.dispatched.length).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })
})
