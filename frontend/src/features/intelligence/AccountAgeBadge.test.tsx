import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AccountAgeBadge } from './AccountAgeBadge'

describe('AccountAgeBadge', () => {
  it('renders nothing when source is helix', () => {
    const { container } = render(<AccountAgeBadge source="helix" bucket="new" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders "approximate" tag when source is approximate', () => {
    const { getByTestId } = render(<AccountAgeBadge source="approximate" bucket="new" />)
    const el = getByTestId('account-age-badge-approximate')
    expect(el).toBeTruthy()
    expect(el.textContent).toContain('approximate')
  })

  it('renders nothing when source is undefined', () => {
    const { container } = render(<AccountAgeBadge source={undefined} bucket="new" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for unknown bucket when source is helix', () => {
    const { container } = render(<AccountAgeBadge source="helix" bucket="unknown" />)
    expect(container.firstChild).toBeNull()
  })
})
