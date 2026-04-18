import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDemoConfig, isDemoMode } from './DemoModeService'

const setSearch = (search: string) => {
  window.history.replaceState({}, '', `/${search}`)
}

describe('DemoModeService', () => {
  beforeEach(() => {
    setSearch('')
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    setSearch('')
    vi.unstubAllEnvs()
  })

  describe('isDemoMode', () => {
    it('returns false when no demo query param is present', () => {
      setSearch('')
      expect(isDemoMode()).toBe(false)
    })

    it('returns true for ?demo=1', () => {
      setSearch('?demo=1')
      expect(isDemoMode()).toBe(true)
    })

    it('returns true for ?demo=playwright', () => {
      setSearch('?demo=playwright')
      expect(isDemoMode()).toBe(true)
    })

    it('returns false for ?demo=somethingElse', () => {
      setSearch('?demo=foo')
      expect(isDemoMode()).toBe(false)
    })

    it('returns false when demo=1 param is not named demo', () => {
      setSearch('?other=1')
      expect(isDemoMode()).toBe(false)
    })
  })

  describe('getDemoConfig', () => {
    it('returns null when not in demo mode', () => {
      setSearch('')
      expect(getDemoConfig()).toBeNull()
    })

    it('returns cached config (no channel) for ?demo=1 when user id + token are set', () => {
      vi.stubEnv('VITE_DEMO_USER_ID', '12345678')
      vi.stubEnv('VITE_DEMO_TOKEN', 'token-abc')
      setSearch('?demo=1')
      // Channel is picked at runtime by a live Helix query — not from env.
      expect(getDemoConfig()).toEqual({
        userId: '12345678',
        token: 'token-abc',
        mode: 'cached',
      })
    })

    it('returns null for ?demo=1 when VITE_DEMO_USER_ID is missing', () => {
      vi.stubEnv('VITE_DEMO_USER_ID', '')
      vi.stubEnv('VITE_DEMO_TOKEN', 'token-abc')
      setSearch('?demo=1')
      expect(getDemoConfig()).toBeNull()
    })

    it('returns null for ?demo=1 when VITE_DEMO_TOKEN is missing', () => {
      vi.stubEnv('VITE_DEMO_USER_ID', '12345678')
      vi.stubEnv('VITE_DEMO_TOKEN', '')
      setSearch('?demo=1')
      expect(getDemoConfig()).toBeNull()
    })

    it('returns fixture config for ?demo=playwright regardless of env vars', () => {
      vi.stubEnv('VITE_DEMO_USER_ID', '')
      vi.stubEnv('VITE_DEMO_TOKEN', '')
      setSearch('?demo=playwright')
      expect(getDemoConfig()).toEqual({
        channel: 'demouser',
        userId: '99999999',
        token: 'PLAYWRIGHT_FIXTURE_TOKEN',
        mode: 'fixture',
      })
    })
  })
})
