import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeletionMarker } from './DeletionMarker'

describe('DeletionMarker', () => {
  it('renders a "Message removed by moderator" marker by default', () => {
    render(<DeletionMarker />)
    expect(screen.getByText(/message removed by moderator/i)).toBeInTheDocument()
  })

  it('renders without displaying an author name', () => {
    render(<DeletionMarker />)
    // The marker is author-agnostic by design (Phase 6 Feature 8 spec).
    // No @username fragment should appear in the output.
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
  })

  it('accepts a "user-cleared" reason without exposing the original author', () => {
    render(<DeletionMarker reason="user-cleared" />)
    expect(screen.getByText(/message removed by moderator/i)).toBeInTheDocument()
  })
})
