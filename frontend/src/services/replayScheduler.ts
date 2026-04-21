import type { RecordedFrame, ReplaySpeed } from '../types/twitch'

export interface ParsedFrame extends RecordedFrame {
  tEpoch: number
}

interface FrameDispatcher {
  dispatchFrame(frame: RecordedFrame): void
}

export interface ReplaySchedulerInit {
  frames: ParsedFrame[]
  firstT: number
  duration: number
  dispatcher: FrameDispatcher
  onReset?: (() => void) | null
  onPosition: (ms: number) => void
}

export class ReplayScheduler {
  private frames: ParsedFrame[]
  private firstT: number
  private duration: number
  private dispatcher: FrameDispatcher
  private onReset: (() => void) | null
  private onPosition: (ms: number) => void
  private cursor = 0
  private speed: ReplaySpeed = 1
  private playing = false
  private positionMs = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private playWallStart = 0
  private playPositionBase = 0

  constructor(init: ReplaySchedulerInit) {
    this.frames = init.frames
    this.firstT = init.firstT
    this.duration = init.duration
    this.dispatcher = init.dispatcher
    this.onReset = init.onReset ?? null
    this.onPosition = init.onPosition
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
      this.dispatcher.dispatchFrame(this.frames[this.cursor]!)
      this.cursor += 1
    }
    this.positionMs = target
    this.onPosition(this.positionMs)
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

  isPlaying(): boolean {
    return this.playing
  }

  dispose(): void {
    this.playing = false
    this.clearTimer()
  }

  private scheduleNext(): void {
    if (!this.playing) return
    if (this.cursor >= this.frames.length) {
      this.playing = false
      this.positionMs = this.duration
      this.onPosition(this.positionMs)
      return
    }
    const nextRel = this.frames[this.cursor]!.tEpoch - this.firstT
    const currentPos = this.currentWallPosition()
    const delay = Math.max(0, (nextRel - currentPos) / this.speed)
    this.timer = setTimeout(() => {
      if (!this.playing) return
      this.dispatcher.dispatchFrame(this.frames[this.cursor]!)
      this.cursor += 1
      this.positionMs = nextRel
      this.playWallStart = Date.now()
      this.playPositionBase = this.positionMs
      this.onPosition(this.positionMs)
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
}
