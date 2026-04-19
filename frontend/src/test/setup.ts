import '@testing-library/jest-dom/vitest'

class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

const ensureStorage = (name: 'localStorage' | 'sessionStorage') => {
  const current = (globalThis as unknown as Record<string, unknown>)[name]
  const isRealStorage =
    current && typeof (current as Storage).setItem === 'function'
  if (isRealStorage) return
  const instance = new MemoryStorage()
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: instance,
  })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      configurable: true,
      value: instance,
    })
  }
}

ensureStorage('localStorage')
ensureStorage('sessionStorage')
