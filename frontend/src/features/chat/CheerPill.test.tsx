import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CheerPill, cheerTierColor } from './CheerPill'

describe('cheerTierColor', () => {
  const cases: Array<[number, string]> = [
    [0, '#9CA3AF'],
    [1, '#9CA3AF'],
    [99, '#9CA3AF'],
    [100, '#8B5CF6'],
    [999, '#8B5CF6'],
    [1000, '#10B981'],
    [4999, '#10B981'],
    [5000, '#3B82F6'],
    [9999, '#3B82F6'],
    [10000, '#EF4444'],
    [100000, '#EF4444'],
  ]

  it.each(cases)('bits=%i → %s', (bits, color) => {
    expect(cheerTierColor(bits)).toBe(color)
  })
})

describe('CheerPill', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders "cheered N bits" text', () => {
    render(<CheerPill bits={500} />)
    expect(screen.getByText(/cheered 500 bits/i)).toBeInTheDocument()
  })

  it('colors the pill at the tier color (inline style)', () => {
    render(<CheerPill bits={10000} />)
    const pill = screen.getByText(/cheered 10000 bits/i)
    expect(pill).toHaveStyle({ color: '#EF4444' })
  })

  it('applies a bounce animation class by default', () => {
    render(<CheerPill bits={100} />)
    const pill = screen.getByText(/cheered 100 bits/i)
    expect(pill.className).toMatch(/cheer-pill-bounce/)
  })

  it('suppresses the bounce animation class when prefers-reduced-motion is reduce', () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia
    try {
      render(<CheerPill bits={100} />)
      const pill = screen.getByText(/cheered 100 bits/i)
      expect(pill.className).not.toMatch(/cheer-pill-bounce/)
    } finally {
      window.matchMedia = original
    }
  })
})
