import { CircularBuffer } from '../lib/circularBuffer'
import { fnv1a } from '../lib/hash'
import { SCHEMA_VERSION } from '../types/recording'
import type { RecordedFrame, RecordingHeader } from '../types/twitch'

const DEFAULT_CAPACITY = 200_000
const DEFAULT_MAX_AGE_MS = 3_600_000
const DEFAULT_RECORDER_VERSION = '0.11.0'
const MIME_TYPE = 'application/x-ndjson'

interface FrameEmitter {
  addFrameListener(cb: (frame: RecordedFrame) => void): () => void
}

export interface SessionRecorderOptions {
  capacity?: number
  maxAgeMs?: number
  hashBroadcasterId?: boolean
  recorderVersion?: string
}

// Architecture-review.md:59-63 — we hash broadcaster_user_id only.
// Chatter user ids, logins, display names, and message text stay intact so
// downstream replay rendering stays faithful. Users own the privacy scope
// decision via this toggle; default OFF.
const hashBroadcasterIdOnDeepCopy = (payload: unknown): unknown => {
  const deep = structuredClone(payload)
  walkAndHashBroadcaster(deep)
  return deep
}

const walkAndHashBroadcaster = (node: unknown): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walkAndHashBroadcaster(child)
    return
  }
  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (key === 'broadcaster_user_id' && typeof value === 'string') {
      record[key] = fnv1a(value)
      continue
    }
    walkAndHashBroadcaster(value)
  }
}

export class SessionRecorder {
  private manager: FrameEmitter
  private buffer: CircularBuffer<RecordedFrame>
  private detachListener: (() => void) | null = null
  private recording = false
  private hashBroadcasterId: boolean
  private recorderVersion: string

  constructor(manager: FrameEmitter, options: SessionRecorderOptions = {}) {
    this.manager = manager
    this.buffer = new CircularBuffer<RecordedFrame>({
      capacity: options.capacity ?? DEFAULT_CAPACITY,
      maxAgeMs: options.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    })
    this.hashBroadcasterId = options.hashBroadcasterId ?? false
    this.recorderVersion = options.recorderVersion ?? DEFAULT_RECORDER_VERSION
    this.detachListener = this.manager.addFrameListener((frame) => {
      if (!this.recording) return
      this.record(frame)
    })
  }

  get isRecording(): boolean {
    return this.recording
  }

  start(): void {
    if (this.recording) return
    this.recording = true
  }

  stop(): void {
    this.recording = false
  }

  setHashBroadcasterId(value: boolean): void {
    this.hashBroadcasterId = value
  }

  getHashBroadcasterId(): boolean {
    return this.hashBroadcasterId
  }

  clear(): void {
    this.buffer.clear()
  }

  dispose(): void {
    this.recording = false
    this.buffer.clear()
    if (this.detachListener) {
      this.detachListener()
      this.detachListener = null
    }
  }

  getBlob(): Blob {
    const header: RecordingHeader = {
      schemaVersion: SCHEMA_VERSION,
      // Header stamping at serialization time is one-shot — it does not affect
      // replay-state determinism (the replayer never reads recordedAt).
      recordedAt: new Date().toISOString(),
      recorderVersion: this.recorderVersion,
    }
    const items = this.buffer.items()
    const lines: string[] = [JSON.stringify(header)]
    for (const frame of items) lines.push(JSON.stringify(frame))
    return new Blob([lines.join('\n')], { type: MIME_TYPE })
  }

  download(channelLogin?: string): void {
    const blob = this.getBlob()
    const url = URL.createObjectURL(blob)
    const safeLogin = channelLogin && channelLogin.length > 0 ? channelLogin : 'unknown'
    const isoTs = new Date().toISOString().replace(/[:.]/g, '-')
    const link = document.createElement('a')
    link.href = url
    link.download = `tcl-session-${safeLogin}-${isoTs}.jsonl`
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    // Release the object URL on the next tick so the browser has time to
    // pick up the download before we invalidate it.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  private record(frame: RecordedFrame): void {
    const payload = this.hashBroadcasterId ? hashBroadcasterIdOnDeepCopy(frame.payload) : frame.payload
    const record: RecordedFrame = { ...frame, payload }
    const tEpoch = Date.parse(frame.t)
    const t = Number.isFinite(tEpoch) ? tEpoch : 0
    this.buffer.push(record, t)
  }
}
