import type { RiskBand } from '../filters/filterQueryTokens'
import type { Token } from '../../lib/theme'

export interface BandStyle {
  dotToken: Token
  labelToken: Token
  pulse: boolean
}

export const styleFor = (band: RiskBand): BandStyle => {
  if (band === 'calm') return { dotToken: 'success', labelToken: 'success', pulse: false }
  if (band === 'elevated') return { dotToken: 'warning', labelToken: 'warning', pulse: false }
  if (band === 'high') return { dotToken: 'warning', labelToken: 'warning', pulse: true }
  return { dotToken: 'danger', labelToken: 'danger', pulse: true }
}

export const bandLabel = (band: RiskBand): string => band.toUpperCase()
