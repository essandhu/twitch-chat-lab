import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRecorder } from './SessionRecorder'
import type { RecordedFrame, RecordingHeader } from '../types/twitch'

interface FakeManager {
  listeners: Set<(f: RecordedFrame) => void>
  addFrameListener: (cb: (f: RecordedFrame) => void) => () => void
  emit: (frame: RecordedFrame) => void
}

const createFakeManager = (): FakeManager => {
  const listeners = new Set<(f: RecordedFrame) => void>()
  return {
    listeners,
    addFrameListener: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    emit: (frame) => {
      for (const cb of listeners) cb(frame)
    },
  }
}

const makeFrame = (overrides: Partial<RecordedFrame> = {}): RecordedFrame => ({
  t: '2025-11-15T19:00:00.000Z',
  kind: 'notification',
  streamLogin: 'shroud',
  payload: { metadata: {}, payload: { subscription: {}, event: { message_id: 'm1' } } },
  ...overrides,
})

async function readFrames(
  blob: Blob,
): Promise<{ header: RecordingHeader; frames: RecordedFrame[] }> {
  const text = await blob.text()
  const lines = text.split('\n')
  const header = JSON.parse(lines[0]!) as RecordingHeader
  const frames = lines.slice(1).map((l) => JSON.parse(l) as RecordedFrame)
  return { header, frames }
}

describe('SessionRecorder', () => {
  let manager: FakeManager

  beforeEach(() => {
    manager = createFakeManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start() + stop() toggle isRecording', () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    expect(rec.isRecording).toBe(false)
    rec.start()
    expect(rec.isRecording).toBe(true)
    rec.stop()
    expect(rec.isRecording).toBe(false)
  })

  it('only captures frames while isRecording', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    manager.emit(makeFrame({ t: 'before-start' as unknown as string }))
    rec.start()
    manager.emit(makeFrame({ t: 't-a' as unknown as string }))
    manager.emit(makeFrame({ t: 't-b' as unknown as string }))
    rec.stop()
    manager.emit(makeFrame({ t: 'after-stop' as unknown as string }))
    const { frames } = await readFrames(rec.getBlob())
    expect(frames).toHaveLength(2)
    expect(frames.map((f) => f.t)).toEqual(['t-a', 't-b'])
  })

  it('FIFO evicts oldest when buffer exceeds capacity', async () => {
    const rec = new SessionRecorder(manager, { capacity: 3 })
    rec.start()
    for (let i = 0; i < 5; i += 1) {
      manager.emit(makeFrame({ t: `t${i}` as unknown as string, payload: { i } }))
    }
    const { frames } = await readFrames(rec.getBlob())
    expect(frames).toHaveLength(3)
    expect((frames[0]!.payload as { i: number }).i).toBe(2)
    expect((frames[2]!.payload as { i: number }).i).toBe(4)
  })

  it('maxAgeMs evicts frames whose t is older than newest - maxAgeMs', async () => {
    const rec = new SessionRecorder(manager, { capacity: 100, maxAgeMs: 1000 })
    rec.start()
    manager.emit(makeFrame({ t: new Date(0).toISOString() }))
    manager.emit(makeFrame({ t: new Date(500).toISOString() }))
    manager.emit(makeFrame({ t: new Date(1500).toISOString() }))
    const { frames } = await readFrames(rec.getBlob())
    expect(frames).toHaveLength(2)
    expect(frames[0]?.t).toBe(new Date(500).toISOString())
  })

  it('getBlob() emits exactly one header line + one frame per captured frame', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    rec.start()
    manager.emit(makeFrame({ t: '2025-11-15T19:00:00.000Z' }))
    manager.emit(makeFrame({ t: '2025-11-15T19:00:01.000Z' }))
    const { header, frames } = await readFrames(rec.getBlob())
    expect(header.schemaVersion).toBe(1)
    expect(header.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(header.recorderVersion.length).toBeGreaterThan(0)
    expect(frames).toHaveLength(2)
    expect(frames[0]!.t).toBe('2025-11-15T19:00:00.000Z')
  })

  it('getBlob() output has MIME type application/x-ndjson', () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    rec.start()
    manager.emit(makeFrame())
    const blob = rec.getBlob()
    expect(blob.type).toBe('application/x-ndjson')
  })

  it('every emitted line is valid JSON', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    rec.start()
    for (let i = 0; i < 4; i += 1) manager.emit(makeFrame({ t: `t${i}` as unknown as string, payload: { i } }))
    const text = await rec.getBlob().text()
    for (const line of text.split('\n')) expect(() => JSON.parse(line)).not.toThrow()
  })

  it('clear() empties the buffer without changing isRecording', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    rec.start()
    manager.emit(makeFrame())
    manager.emit(makeFrame())
    rec.clear()
    expect(rec.isRecording).toBe(true)
    const { frames } = await readFrames(rec.getBlob())
    expect(frames).toHaveLength(0)
  })

  it('start + stop + start re-enables buffering and preserves prior buffer', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    rec.start()
    manager.emit(makeFrame({ t: 't1' as unknown as string }))
    rec.stop()
    manager.emit(makeFrame({ t: 'blocked' as unknown as string }))
    rec.start()
    manager.emit(makeFrame({ t: 't2' as unknown as string }))
    const { frames } = await readFrames(rec.getBlob())
    expect(frames.map((f) => f.t)).toEqual(['t1', 't2'])
  })

  it('with hashBroadcasterId=false, broadcaster_user_id in payload stays intact', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10, hashBroadcasterId: false })
    rec.start()
    manager.emit(makeHashTestFrame('12345'))
    const { frames } = await readFrames(rec.getBlob())
    const inner = (frames[0]!.payload as { payload: { event: any } }).payload.event
    expect(inner.broadcaster_user_id).toBe('12345')
    expect(inner.user_id).toBe('chatter_a')
  })

  it('with hashBroadcasterId=true, broadcaster_user_id becomes an FNV-1a hash; chatter ids unchanged', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10, hashBroadcasterId: true })
    rec.start()
    manager.emit(makeHashTestFrame('12345'))
    const { frames } = await readFrames(rec.getBlob())
    const inner = (frames[0]!.payload as { payload: { event: any } }).payload.event
    expect(inner.broadcaster_user_id).not.toBe('12345')
    expect(inner.broadcaster_user_id).toMatch(/^[0-9a-f]{8}$/)
    expect(inner.user_id).toBe('chatter_a')
    expect(inner.user_login).toBe('alice')
    expect(inner.user_name).toBe('Alice')
  })

  it('hashBroadcasterId produces a deterministic hash — same id hashes to same output', async () => {
    const rec = new SessionRecorder(manager, { capacity: 10, hashBroadcasterId: true })
    rec.start()
    manager.emit(makeHashTestFrame('AAA'))
    manager.emit(makeHashTestFrame('AAA'))
    manager.emit(makeHashTestFrame('BBB'))
    const { frames } = await readFrames(rec.getBlob())
    const a0 = (frames[0]!.payload as { payload: { event: any } }).payload.event.broadcaster_user_id
    const a1 = (frames[1]!.payload as { payload: { event: any } }).payload.event.broadcaster_user_id
    const b = (frames[2]!.payload as { payload: { event: any } }).payload.event.broadcaster_user_id
    expect(a0).toBe(a1)
    expect(a0).not.toBe(b)
  })

  it('download() triggers a browser download via URL.createObjectURL', () => {
    const createSpy = vi.fn(() => 'blob:mock')
    const revokeSpy = vi.fn()
    const origC = URL.createObjectURL
    const origR = URL.revokeObjectURL
    URL.createObjectURL = createSpy as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeSpy as unknown as typeof URL.revokeObjectURL
    try {
      const rec = new SessionRecorder(manager, { capacity: 10 })
      rec.start()
      manager.emit(makeFrame())
      rec.download('shroud')
      expect(createSpy).toHaveBeenCalledTimes(1)
    } finally {
      URL.createObjectURL = origC
      URL.revokeObjectURL = origR
    }
  })

  it('download() filename includes channel login and .jsonl extension', () => {
    let capturedFilename = ''
    const originalCreateElement = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag as keyof HTMLElementTagNameMap)
      if (tag === 'a') {
        Object.defineProperty(el, 'download', {
          set(v: string) {
            capturedFilename = v
          },
          get() {
            return capturedFilename
          },
          configurable: true,
        })
      }
      return el
    })
    const origC = URL.createObjectURL
    const origR = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:x') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    try {
      const rec = new SessionRecorder(manager, { capacity: 10 })
      rec.start()
      manager.emit(makeFrame())
      rec.download('shroud')
      expect(capturedFilename).toMatch(/^tcl-session-shroud-.*\.jsonl$/)
    } finally {
      spy.mockRestore()
      URL.createObjectURL = origC
      URL.revokeObjectURL = origR
    }
  })

  it('round-trip: record → getBlob → parse produces deterministic frame content', async () => {
    const rec = new SessionRecorder(manager, { capacity: 100 })
    rec.start()
    const originalFrames = [
      makeFrame({ t: 't0' as unknown as string, payload: { a: 1 } }),
      makeFrame({ t: 't1' as unknown as string, payload: { b: 2 } }),
      makeFrame({ t: 't2' as unknown as string, payload: { c: 3 } }),
    ]
    for (const f of originalFrames) manager.emit(f)
    const { frames } = await readFrames(rec.getBlob())
    expect(frames).toHaveLength(3)
    for (let i = 0; i < 3; i += 1) {
      expect(frames[i]!.t).toBe(originalFrames[i]!.t)
      expect(frames[i]!.payload).toEqual(originalFrames[i]!.payload)
      expect(frames[i]!.kind).toBe(originalFrames[i]!.kind)
      expect(frames[i]!.streamLogin).toBe(originalFrames[i]!.streamLogin)
    }
  })

  it('dispose() detaches the frame listener cleanly', () => {
    const rec = new SessionRecorder(manager, { capacity: 10 })
    rec.start()
    manager.emit(makeFrame())
    expect(manager.listeners.size).toBeGreaterThan(0)
    rec.dispose()
    expect(manager.listeners.size).toBe(0)
  })
})

function makeHashTestFrame(broadcasterId: string): RecordedFrame {
  return {
    t: '2025-11-15T19:00:00.000Z',
    kind: 'notification',
    streamLogin: 'shroud',
    payload: {
      metadata: {},
      payload: {
        subscription: {},
        event: {
          broadcaster_user_id: broadcasterId,
          user_id: 'chatter_a',
          user_login: 'alice',
          user_name: 'Alice',
          message_id: 'm1',
        },
      },
    },
  }
}
