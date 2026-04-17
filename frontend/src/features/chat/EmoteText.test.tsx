import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmoteText } from './EmoteText'
import type { MessageFragment } from '../../types/twitch'

describe('EmoteText', () => {
  it('renders text fragments as <span> and emote fragments as <img> in order', () => {
    const fragments: MessageFragment[] = [
      { type: 'text', text: 'Hello ' },
      { type: 'emote', text: 'Kappa', emote: { id: '25' } },
      { type: 'text', text: ' world' },
    ]
    const { container } = render(<EmoteText fragments={fragments} />)

    const children = Array.from(container.childNodes)
    expect(children).toHaveLength(3)
    expect((children[0] as HTMLElement).tagName).toBe('SPAN')
    expect((children[0] as HTMLElement).textContent).toBe('Hello ')
    expect((children[1] as HTMLElement).tagName).toBe('IMG')
    expect((children[2] as HTMLElement).tagName).toBe('SPAN')
    expect((children[2] as HTMLElement).textContent).toBe(' world')
  })

  it('emote src equals the Twitch CDN URL for the given id', () => {
    const fragments: MessageFragment[] = [
      { type: 'emote', text: 'Kappa', emote: { id: '25' } },
    ]
    render(<EmoteText fragments={fragments} />)

    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe(
      'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
    )
  })

  it('emote alt equals the fragment text', () => {
    const fragments: MessageFragment[] = [
      { type: 'emote', text: 'PogChamp', emote: { id: '88' } },
    ]
    render(<EmoteText fragments={fragments} />)

    const img = screen.getByRole('img')
    expect(img.getAttribute('alt')).toBe('PogChamp')
  })

  it('empty fragments array renders no children', () => {
    const { container } = render(<EmoteText fragments={[]} />)
    expect(container.childNodes).toHaveLength(0)
  })
})
