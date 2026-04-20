import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyFilterFromUrl } from './applyFilterFromUrl'

const encode = (q: string): string => btoa(encodeURIComponent(q))

const setUrl = (search: string): void => {
  window.history.replaceState(null, '', `/${search}`)
}

describe('applyFilterFromUrl', () => {
  let setChatFilter: ReturnType<typeof vi.fn>
  let applyToAllStreams: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setChatFilter = vi.fn()
    applyToAllStreams = vi.fn()
    setUrl('')
  })

  afterEach(() => {
    setUrl('')
  })

  it('does nothing when filter param is absent', () => {
    setUrl('?foo=bar')
    applyFilterFromUrl({ isMultiActive: false, setChatFilter, applyToAllStreams })
    expect(setChatFilter).not.toHaveBeenCalled()
    expect(applyToAllStreams).not.toHaveBeenCalled()
  })

  it('applies decoded query to chatStore in single-stream mode', () => {
    setUrl(`?filter=${encode('role:sub AND hype')}`)
    applyFilterFromUrl({ isMultiActive: false, setChatFilter, applyToAllStreams })
    expect(setChatFilter).toHaveBeenCalledWith({ query: 'role:sub AND hype', queryError: null })
    expect(applyToAllStreams).not.toHaveBeenCalled()
  })

  it('fans out to all streams in multi-stream mode', () => {
    setUrl(`?filter=${encode('kw:"pog"')}`)
    applyFilterFromUrl({ isMultiActive: true, setChatFilter, applyToAllStreams })
    expect(applyToAllStreams).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'kw:"pog"', queryError: null }),
    )
    expect(setChatFilter).not.toHaveBeenCalled()
  })

  it('strips filter param from URL after applying', () => {
    setUrl(`?filter=${encode('foo')}&keep=1`)
    applyFilterFromUrl({ isMultiActive: false, setChatFilter, applyToAllStreams })
    expect(window.location.search).toBe('')
  })

  it('no-ops silently on invalid base64', () => {
    setUrl('?filter=%%%not-b64')
    applyFilterFromUrl({ isMultiActive: false, setChatFilter, applyToAllStreams })
    expect(setChatFilter).not.toHaveBeenCalled()
    expect(applyToAllStreams).not.toHaveBeenCalled()
  })
})
