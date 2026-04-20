import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FilterState } from '../../types/twitch'
import { FilterToolbar } from './FilterToolbar'

const base: FilterState = {
  firstTimeOnly: false,
  subscribersOnly: false,
  keyword: '',
  hypeModeOnly: false,
}

describe('FilterToolbar', () => {
  it('renders toggle buttons in single mode without apply-to-all', () => {
    render(<FilterToolbar filterState={base} onFilterStateChange={vi.fn()} />)
    expect(screen.getByText('First-Timers')).toBeInTheDocument()
    expect(screen.getByText('Subscribers')).toBeInTheDocument()
    expect(screen.getByText('Hype Mode')).toBeInTheDocument()
    expect(screen.queryByText('Apply to all')).not.toBeInTheDocument()
  })

  it('renders Apply to all button in multi mode', () => {
    render(
      <FilterToolbar
        filterState={base}
        onFilterStateChange={vi.fn()}
        onApplyToAllStreams={vi.fn()}
        mode="multi"
      />,
    )
    expect(screen.getByText('Apply to all')).toBeInTheDocument()
  })

  it('clicking a toggle calls onFilterStateChange with flipped flag', () => {
    const onChange = vi.fn()
    render(<FilterToolbar filterState={base} onFilterStateChange={onChange} />)
    fireEvent.click(screen.getByText('First-Timers'))
    expect(onChange).toHaveBeenCalledWith({ ...base, firstTimeOnly: true })
  })

  it('Apply to all invokes callback with current state', () => {
    const onApply = vi.fn()
    const state: FilterState = { ...base, firstTimeOnly: true }
    render(
      <FilterToolbar
        filterState={state}
        onFilterStateChange={vi.fn()}
        onApplyToAllStreams={onApply}
        mode="multi"
      />,
    )
    fireEvent.click(screen.getByText('Apply to all'))
    expect(onApply).toHaveBeenCalledWith(state)
  })

  it('shows filter-count badge when filters active', () => {
    render(
      <FilterToolbar
        filterState={{ ...base, subscribersOnly: true }}
        onFilterStateChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('filter-count')).toHaveTextContent('1')
  })
})
