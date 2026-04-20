import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FilterState } from '../../types/twitch'
import { KeywordFilter } from './KeywordFilter'

const base: FilterState = {
  firstTimeOnly: false,
  subscribersOnly: false,
  keyword: '',
  hypeModeOnly: false,
}

describe('KeywordFilter', () => {
  it('empty input clears query and error', () => {
    const onChange = vi.fn()
    render(
      <KeywordFilter
        filterState={{ ...base, query: 'role:sub', queryError: null }}
        onFilterStateChange={onChange}
      />,
    )
    fireEvent.click(screen.getByLabelText('Clear query'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ query: '', queryError: null }),
    )
  })

  it('valid DSL sets query and null error', () => {
    const onChange = vi.fn()
    render(<KeywordFilter filterState={base} onFilterStateChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Keyword filter'), {
      target: { value: 'role:sub' },
    })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'role:sub', queryError: null }),
    )
  })

  it('invalid regex surfaces queryError', () => {
    const onChange = vi.fn()
    render(<KeywordFilter filterState={base} onFilterStateChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Keyword filter'), {
      target: { value: 'regex:/[/' },
    })
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(last.query).toBe('regex:/[/')
    expect(last.queryError).toMatch(/invalid regex/i)
  })

  it('renders alert role when queryError present', () => {
    render(
      <KeywordFilter
        filterState={{ ...base, query: 'bad)', queryError: 'unbalanced parenthesis' }}
        onFilterStateChange={vi.fn()}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('unbalanced parenthesis')
  })

  it('does not render alert when no error', () => {
    render(
      <KeywordFilter
        filterState={{ ...base, query: 'ok', queryError: null }}
        onFilterStateChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
