import { RecorderSchemaError, SCHEMA_VERSION } from '../types/recording'
import type { RecordedFrame, RecordingHeader, ReplaySpeed } from '../types/twitch'
import { ReplayScheduler, type ParsedFrame } from './replayScheduler'

interface FrameDispatcher {
  dispatchFrame(frame: RecordedFrame): void
}

export interface LoadInfo {
  header: RecordingHeader
  frameCount: number
  duration: number
  streamLogins: string[]
}

export interface SessionReplayerOptions {
  onReset?: () => void
}

export class SessionReplayer {
  private manager: FrameDispatcher
  private onReset: (() => void) | null
  header: RecordingHeader | null = null
  private firstT = 0
  private duration = 0
  private scheduler: ReplayScheduler | null = null
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
    this.firstT = firstT
    this.duration = lastT - firstT

    this.scheduler?.dispose()
    this.scheduler = new ReplayScheduler({
      frames: parsed,
      firstT,
      duration: this.duration,
      dispatcher: this.manager,
      onReset: this.onReset,
      onPosition: (ms) => this.notifyPosition(ms),
    })

    return {
      header,
      frameCount: parsed.length,
      duration: this.duration,
      streamLogins,
    }
  }

  play(): void {
    this.scheduler?.play()
  }

  pause(): void {
    this.scheduler?.pause()
  }

  setSpeed(speed: ReplaySpeed): void {
    this.scheduler?.setSpeed(speed)
  }

  seekTo(wallClockMs: number): void {
    this.scheduler?.seekTo(wallClockMs)
  }

  getPosition(): number {
    return this.scheduler?.getPosition() ?? 0
  }

  getDuration(): number {
    return this.duration
  }

  getFirstT(): number {
    return this.firstT
  }

  isPlaying(): boolean {
    return this.scheduler?.isPlaying() ?? false
  }

  onPositionChange(cb: (ms: number) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  dispose(): void {
    this.scheduler?.dispose()
    this.scheduler = null
    this.listeners.clear()
  }

  private notifyPosition(ms: number): void {
    for (const cb of this.listeners) {
      try {
        cb(ms)
      } catch {
        // swallow — position listener is presentational
      }
    }
  }
}
