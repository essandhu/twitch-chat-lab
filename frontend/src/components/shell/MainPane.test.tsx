import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MainPane } from './MainPane'

describe('MainPane', () => {
  it('renders children', () => {
    render(
      <MainPane>
        <p>hello-world</p>
      </MainPane>,
    )
    expect(screen.getByText('hello-world')).toBeInTheDocument()
  })

  it('forwards className via cn on root div', () => {
    render(
      <MainPane className="x-extra">
        <p>child</p>
      </MainPane>,
    )
    const root = document.querySelector('[data-shell-section="main-pane-inner"]')
    expect(root).not.toBeNull()
    expect(root?.className).toContain('x-extra')
  })

  it('root has flex, flex-col, and overflow-hidden classes', () => {
    render(
      <MainPane>
        <p>child</p>
      </MainPane>,
    )
    const root = document.querySelector('[data-shell-section="main-pane-inner"]')
    expect(root?.className).toContain('flex')
    expect(root?.className).toContain('flex-col')
    expect(root?.className).toContain('overflow-hidden')
  })
})
