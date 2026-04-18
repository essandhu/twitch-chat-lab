import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DemoBanner } from './DemoBanner'

describe('DemoBanner', () => {
  it('renders the read-only demo notice', () => {
    render(<DemoBanner onSignIn={() => {}} />)
    expect(screen.getByText(/read-only demo mode/i)).toBeInTheDocument()
  })

  it('explains that sending and channel-changing are disabled', () => {
    render(<DemoBanner onSignIn={() => {}} />)
    expect(
      screen.getByText(/cannot send messages or change channels/i),
    ).toBeInTheDocument()
  })

  it('invokes the onSignIn callback when the sign-in link is activated', () => {
    const onSignIn = vi.fn()
    render(<DemoBanner onSignIn={onSignIn} />)
    const signIn = screen.getByRole('button', { name: /sign in with twitch/i })
    fireEvent.click(signIn)
    expect(onSignIn).toHaveBeenCalledOnce()
  })
})
