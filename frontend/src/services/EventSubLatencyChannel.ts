let lastSample: number | null = null

export function recordLatencySample(nowMs: number, messageTimestamp: string): void {
  const parsed = Date.parse(messageTimestamp)
  if (Number.isNaN(parsed)) return
  lastSample = Math.max(0, nowMs - parsed)
}

export function readLatencySample(): number | null {
  return lastSample
}

export function __resetForTests(): void {
  lastSample = null
}
