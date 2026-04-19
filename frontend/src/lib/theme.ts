export const TOKENS = {
  bg: '--bg',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  surfaceHover: '--surface-hover',
  border: '--border',
  text: '--text',
  textMuted: '--text-muted',
  accent: '--accent',
  accentHover: '--accent-hover',
  accentContrast: '--accent-contrast',
  danger: '--danger',
  success: '--success',
  warning: '--warning',
} as const

export type Token = keyof typeof TOKENS

export const tokenRgb = (name: Token): string => `rgb(var(${TOKENS[name]}))`

export const tokenRgba = (name: Token, alpha: number): string =>
  `rgb(var(${TOKENS[name]}) / ${alpha})`
