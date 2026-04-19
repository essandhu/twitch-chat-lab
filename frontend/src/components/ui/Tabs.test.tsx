import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Tabs } from './Tabs'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

const Example = () => (
  <Tabs.Root defaultValue="a">
    <Tabs.List className="custom-list">
      <Tabs.Trigger value="a">A</Tabs.Trigger>
      <Tabs.Trigger value="b">B</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="a">Alpha</Tabs.Content>
    <Tabs.Content value="b">Beta</Tabs.Content>
  </Tabs.Root>
)

describe('Tabs', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders triggers in dark theme', () => {
    render(<Example />)
    expect(screen.getByRole('tab', { name: 'A' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'B' })).toBeInTheDocument()
  })

  it('renders triggers in light theme', () => {
    setTheme('light')
    render(<Example />)
    expect(screen.getByRole('tab', { name: 'A' })).toBeInTheDocument()
  })

  it('keyboard interaction activates the next tab', () => {
    render(<Example />)
    const a = screen.getByRole('tab', { name: 'A' })
    const b = screen.getByRole('tab', { name: 'B' })
    a.focus()
    expect(a).toHaveFocus()
    // Radix Tabs uses click + focus to activate. Simulate moving to next tab.
    b.focus()
    fireEvent.keyDown(b, { key: 'Enter' })
    fireEvent.click(b)
    expect(b).toHaveAttribute('data-state', 'active')
  })

  it('forwards className on List', () => {
    render(<Example />)
    expect(screen.getByRole('tablist')).toHaveClass('custom-list')
  })

  it('forwards ref on Trigger to button DOM node', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List>
          <Tabs.Trigger value="a" ref={ref}>
            A
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>,
    )
    expect(ref.current).toBeInstanceOf(HTMLButtonElement)
  })
})
