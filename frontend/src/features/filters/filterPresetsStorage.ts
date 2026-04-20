export interface Preset {
  name: string
  query: string
}

const STORAGE_KEY = 'tcl.filter.presets'

const safeStorage = (): Storage | null => {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export const readPresets = (): Preset[] => {
  const store = safeStorage()
  if (!store) return []
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is Preset =>
        p !== null &&
        typeof p === 'object' &&
        typeof (p as Preset).name === 'string' &&
        typeof (p as Preset).query === 'string',
    )
  } catch {
    return []
  }
}

export const writePresets = (presets: Preset[]): void => {
  const store = safeStorage()
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(presets))
  } catch {
    // SecurityError / quota — swallow; presets are best-effort.
  }
}

export const addPreset = (name: string, query: string): Preset[] => {
  const current = readPresets()
  const next: Preset[] = [
    ...current.filter((p) => p.name !== name),
    { name, query },
  ]
  writePresets(next)
  return next
}

export const deletePreset = (name: string): Preset[] => {
  const next = readPresets().filter((p) => p.name !== name)
  writePresets(next)
  return next
}
