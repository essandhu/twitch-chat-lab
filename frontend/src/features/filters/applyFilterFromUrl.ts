import type { FilterState } from '../../types/twitch'

export interface FilterUrlDeps {
  isMultiActive: boolean
  setChatFilter: (partial: Partial<FilterState>) => void
  applyToAllStreams: (state: FilterState) => void
}

const DEFAULT_FILTER_STATE: FilterState = {
  firstTimeOnly: false,
  subscribersOnly: false,
  keyword: '',
  hypeModeOnly: false,
}

const decode = (encoded: string): string | null => {
  try {
    return decodeURIComponent(atob(encoded))
  } catch {
    return null
  }
}

export const applyFilterFromUrl = (deps: FilterUrlDeps): void => {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('filter')
  if (!raw) return
  const query = decode(raw)
  if (query === null) return
  if (deps.isMultiActive) {
    deps.applyToAllStreams({ ...DEFAULT_FILTER_STATE, query, queryError: null })
  } else {
    deps.setChatFilter({ query, queryError: null })
  }
  window.history.replaceState(null, '', window.location.pathname)
}
