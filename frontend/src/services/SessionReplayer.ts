import { RecorderSchemaError, SCHEMA_VERSION } from '../types/recording'
import type { RecordedFrame, RecordingHeader, ReplaySpeed } from '../types/twitch'

interface FrameDispatcher {
  dispatchFrame(frame: RecordedFrame): void
}

export interface LoadInfo {
  header: RecordingHeader
  frameCount: number
  duration: number
  streamLogins: string[]
}

interface ParsedFrame extends RecordedFrame {
  tEpoch: number
}

export interface SessionReplayerOptions {
  onReset?: () => void
}

export class SessionReplayer {
  private manager: FrameDispatcher
  private onReset: (() => void) | null
  header: RecordingHeader | null = null
  private frames: ParsedFrame[] = []
  private cursor = 0
  private firstT = 0
  private duration = 0
  private speed: ReplaySpeed = 1
  private playing = false
  private positionMs = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private playWallStart = 0
  private playPositionBase = 0
  private listeners = new Set<(ms: number) => void>()

  constructor(manager: FrameDispatcher, options: SessionReplayerOptions = {}) {
    this.manager = manager
    this.onReset = options.onReset ?? null
  }

  async load(source: Blob | File): Promise<LoadInfo> {
    const text = await source.text()
    const lines = text.split('\n')
    if (lines.length === 0 || lines[0] === '') {
      throw new RecorderSchemaError({ code: 'empty-recording' })
    }
    let header: RecordingHeader
    try {
      header = JSON.parse(lines[0]!) as RecordingHeader
    } catch (err) {
      throw new RecorderSchemaError({ code: 'malformed-header', details: String(err) })
    }
    if (header.schemaVersion !== SCHEMA_VERSION) {
      throw new RecorderSchemaError({
        code: 'unknown-schema-version',
        details: { found: header.schemaVersion, expected: SCHEMA_VERSION },
      })
    }

    const frameLines = lines.slice(1).filter((l) => l.length > 0)
    if (frameLines.length === 0) {
      throw new RecorderSchemaError({ code: 'empty-recording' })
    }

    const parsed: ParsedFrame[] = []
    for (const line of frameLines) {
      let frame: RecordedFrame
      try {
        frame = JSON.parse(line) as RecordedFrame
      } catch (err) {
        throw new RecorderSchemaError({ code: 'malformed-frame', details: String(err) })
      }
      const tEpoch = Date.parse(frame.t)
      if (!Number.isFinite(tEpoch)) {
        throw new RecorderSchemaError({ code: 'malformed-frame', details: { t: frame.t } })
      }
      parsed.push({ ...frame, tEpoch })
    }
    parsed.sort((a, b) => a.tEpoch - b.tEpoch)

    const streamLogins = Array.from(new Set(parsed.map((f) => f.streamLogin)))
    const firstT = parsed[0]!.tEpoch
    const lastT = parsed[parsed.length - 1]!.tEpoch

    this.header = header
    this.frames = parsed
    this.firstT = firstT
    this.duration = lastT - firstT
    this.cursor = 0
    this.positionMs = 0
    this.clearTimer()

    return {
      header,
      frameCount: parsed.length,
      duration: this.duration,
      streamLogins,
    }
  }

  play(): void {
    if (this.playing) return
    if (this.cursor >= this.frames.length) return
    this.playing = true
    this.playWallStart = Date.now()
    this.playPositionBase = this.positionMs
    this.scheduleNext()
  }

  pause(): void {
    if (!this.playing) return
    this.updatePositionFromWall()
    this.playing = false
    this.clearTimer()
  }

  setSpeed(speed: ReplaySpeed): void {
    if (this.playing) {
      this.updatePositionFromWall()
      this.clearTimer()
    }
    this.speed = speed
    if (this.playing) {
      this.playWallStart = Date.now()
      this.playPositionBase = this.positionMs
      this.scheduleNext()
    }
  }

  seekTo(wallClockMs: number): void {
    const wasPlaying = this.playing
    if (this.playing) {
      this.clearTimer()
      this.playing = false
    }
    const target = Math.max(0, Math.min(wallClockMs, this.duration))
    if (target < this.positionMs && this.onReset) {
      this.onReset()
      this.cursor = 0
      this.positionMs = 0
    }
    while (this.cursor < this.frames.length) {
      const rel = this.frames[this.cursor]!.tEpoch - this.firstT
      if (rel > target) break
      this.manager.dispatchFrame(this.frames[this.cursor]!)
      this.cursor += 1
    }
    this.positionMs = target
    this.notifyPosition()
    if (wasPlaying) {
      this.playing = true
      this.playWallStart = Date.now()
      this.playPositionBase = this.positionMs
      this.scheduleNext()
    }
  }

  getPosition(): number {
    if (!this.playing) return this.positionMs
    return this.currentWallPosition()
  }

  getDuration(): number {
    return this.duration
  }

  getFirstT(): number {
    return this.firstT
  }

  isPlaying(): boolean {
    return this.playing
  }

  onPositionChange(cb: (ms: number) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  dispose(): void {
    this.playing = false
    this.clearTimer()
    this.listeners.clear()
  }

  private scheduleNext(): void {
    if (!this.playing) return
    if (this.cursor >= this.frames.length) {
      this.playing = false
      this.positionMs = this.duration
      this.notifyPosition()
      return
    }
    const nextRel = this.frames[this.cursor]!.tEpoch - this.firstT
    const currentPos = this.currentWallPosition()
    const delay = Math.max(0, (nextRel - currentPos) / this.speed)
    this.timer = setTimeout(() => {
      if (!this.playing) return
      this.manager.dispatchFrame(this.frames[this.cursor]!)
      this.cursor += 1
      this.positionMs = nextRel
      this.playWallStart = Date.now()
      this.playPositionBase = this.positionMs
      this.notifyPosition()
      this.scheduleNext()
    }, delay)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private currentWallPosition(): number {
    if (!this.playing) return this.positionMs
    const elapsed = (Date.now() - this.playWallStart) * this.speed
    return this.playPositionBase + elapsed
  }

  private updatePositionFromWall(): void {
    this.positionMs = this.currentWallPosition()
  }

  private notifyPosition(): void {
    for (const cb of this.listeners) {
      try {
        cb(this.positionMs)
      } catch {
        // swallow — position listener is presentational
      }
    }
  }
}
