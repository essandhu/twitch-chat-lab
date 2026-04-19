import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SystemEvent } from '../../types/twitch'
import { SystemEventRow } from './SystemEventRow'

describe('SystemEventRow', () => {
  it('sub — renders "subscribed at Tier N" with cumulative-months pill', () => {
    const ev: SystemEvent = {
      noticeType: 'sub',
      userName: 'Alice',
      tier: '1000',
      cumulativeMonths: 3,
      isGift: false,
    }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/subscribed/i)).toBeInTheDocument()
    expect(screen.getByText(/Tier 1/)).toBeInTheDocument()
    expect(screen.getByText(/3mo/)).toBeInTheDocument()
  })

  it('resub — renders "resubscribed" plus optional streak pill when streakMonths is set', () => {
    const ev: SystemEvent = {
      noticeType: 'resub',
      userName: 'Alice',
      tier: '2000',
      cumulativeMonths: 12,
      streakMonths: 6,
      durationMonths: 1,
    }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/resubscribed/i)).toBeInTheDocument()
    expect(screen.getByText(/Tier 2/)).toBeInTheDocument()
    expect(screen.getByText(/12mo/)).toBeInTheDocument()
    expect(screen.getByText(/6/)).toBeInTheDocument()
  })

  it('resub — omits streak pill when streakMonths is null', () => {
    const ev: SystemEvent = {
      noticeType: 'resub',
      userName: 'Alice',
      tier: '1000',
      cumulativeMonths: 4,
      streakMonths: null,
      durationMonths: 1,
    }
    const { container } = render(<SystemEventRow event={ev} />)
    expect(container.textContent).not.toMatch(/🔥/)
  })

  it('gift-sub — pluralizes when total > 1', () => {
    const ev: SystemEvent = {
      noticeType: 'gift-sub',
      fromUserName: 'Alice',
      total: 5,
      tier: '1000',
      isAnonymous: false,
    }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/gifted 5 Tier 1 subs/i)).toBeInTheDocument()
  })

  it('gift-sub — renders anonymous text when isAnonymous', () => {
    const ev: SystemEvent = {
      noticeType: 'gift-sub',
      fromUserName: 'Anonymous',
      total: 1,
      tier: '1000',
      isAnonymous: true,
    }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/anonymous/i)).toBeInTheDocument()
  })

  it('raid — renders "raided with N viewers"', () => {
    const ev: SystemEvent = { noticeType: 'raid', fromUserName: 'Charlie', viewers: 42 }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/Charlie/)).toBeInTheDocument()
    expect(screen.getByText(/raided with 42 viewers/i)).toBeInTheDocument()
  })

  it('announcement — renders colored left bar by color field', () => {
    const ev: SystemEvent = {
      noticeType: 'announcement',
      userName: 'Mod',
      body: 'Hello chat',
      color: 'PURPLE',
    }
    const { container } = render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/Hello chat/)).toBeInTheDocument()
    expect(screen.getByText(/Mod/)).toBeInTheDocument()
    const bar = container.querySelector('[data-announcement-color="PURPLE"]')
    expect(bar).not.toBeNull()
  })

  it('bits-badge-tier — renders "earned the {tier}-bits badge tier"', () => {
    const ev: SystemEvent = { noticeType: 'bits-badge-tier', userName: 'Alice', tier: 1000 }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/1000-bits badge tier/i)).toBeInTheDocument()
  })

  it('charity-donation — renders the value + currency', () => {
    const ev: SystemEvent = {
      noticeType: 'charity-donation',
      userName: 'Alice',
      amount: { value: 5, currency: 'USD' },
    }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/5 USD/i)).toBeInTheDocument()
  })

  it('shared-chat-joined — renders the joining channel name', () => {
    const ev: SystemEvent = {
      noticeType: 'shared-chat-joined',
      broadcasterUserName: 'Friend',
    }
    render(<SystemEventRow event={ev} />)
    expect(screen.getByText(/Friend/)).toBeInTheDocument()
    expect(screen.getByText(/shared chat/i)).toBeInTheDocument()
  })
})
