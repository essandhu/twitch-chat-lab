import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { pairKeyFor, useMultiStreamStore } from '../../store/multiStreamStore'
import { CorrelationPanel } from './CorrelationPanel'

const seed = (login: string): void => {
  useMultiStreamStore.getState().addStream({
    login,
    displayName: login.toUpperCase(),
    broadcasterId: `b_${login}`,
  })
}

describe('CorrelationPanel', () => {
  beforeEach(() => {
    useMultiStreamStore.getState().reset()
  })

  it('renders null when not active', () => {
    seed('a')
    seed('b')
    const { container } = render(<CorrelationPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders null when less than 2 streams', () => {
    seed('a')
    useMultiStreamStore.setState({ isActive: true })
    const { container } = render(<CorrelationPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders chart container when active with >=2 streams', () => {
    seed('alpha')
    seed('beta')
    useMultiStreamStore.setState({
      isActive: true,
      correlation: {
        [pairKeyFor('alpha', 'beta')]: { coefficient: 0.77, lagMs: 2000, updatedAt: Date.now() },
      },
    })
    render(<CorrelationPanel />)
    expect(screen.getByTestId('correlation-chart')).toBeInTheDocument()
  })

  it('handles NaN coefficient without crashing', () => {
    seed('alpha')
    seed('beta')
    useMultiStreamStore.setState({
      isActive: true,
      correlation: {
        [pairKeyFor('alpha', 'beta')]: {
          coefficient: Number.NaN,
          lagMs: 0,
          updatedAt: Date.now(),
        },
      },
    })
    render(<CorrelationPanel />)
    expect(screen.getByTestId('correlation-chart')).toBeInTheDocument()
  })
})
