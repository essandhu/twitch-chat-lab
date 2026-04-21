interface BufferEntry<T> {
  item: T
  t: number
}

interface CircularBufferOptions {
  capacity: number
  maxAgeMs?: number
}

export class CircularBuffer<T> {
  private readonly capacity: number
  private readonly maxAgeMs: number | null
  private entries: BufferEntry<T>[] = []

  constructor(options: CircularBufferOptions) {
    this.capacity = options.capacity
    this.maxAgeMs = options.maxAgeMs ?? null
  }

  get size(): number {
    return this.entries.length
  }

  push(item: T, t: number): void {
    if (this.maxAgeMs !== null) {
      const cutoff = t - this.maxAgeMs
      while (this.entries.length > 0 && this.entries[0]!.t < cutoff) {
        this.entries.shift()
      }
    }
    this.entries.push({ item, t })
    while (this.entries.length > this.capacity) {
      this.entries.shift()
    }
  }

  items(): T[] {
    return this.entries.map((e) => e.item)
  }

  clear(): void {
    this.entries = []
  }
}
