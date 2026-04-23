import { useContext } from 'react'
import { SafeModeContext, type SafeModeContextValue } from '../components/SafeModeProvider'

const NOOP_VALUE: SafeModeContextValue = {
  safeMode: false,
  setSafeMode: () => {},
  toggleSafeMode: () => {},
}

// Falls back to a no-op (safe mode off) when no provider is in scope so
// components can be rendered standalone in tests without ceremony.
export const useSafeMode = (): SafeModeContextValue => {
  return useContext(SafeModeContext) ?? NOOP_VALUE
}
