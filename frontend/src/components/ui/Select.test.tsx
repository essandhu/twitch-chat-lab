import { render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Select } from './Select'

const setTheme = (theme: 'dark' | 'light') => {
  document.documentElement.setAttribute('data-theme', theme)
}

describe('Select', () => {
  beforeEach(() => {
    setTheme('dark')
  })

  it('renders in dark theme', () => {
    render(
      <Select aria-label="pick">
        <option value="a">A</option>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'pick' })).toBeInTheDocument()
  })

  it('renders in light theme', () => {
    setTheme('light')
    render(
      <Select aria-label="pick">
        <option value="a">A</option>
      </Select>,
    )
    expect(screen.getByRole('combobox', { name: 'pick' })).toBeInTheDocument()
  })

  it('renders options passed as children', () => {
    render(
      <Select aria-label="pick" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    )
    const el = screen.getByRole('combobox', { name: 'pick' }) as HTMLSelectElement
    expect(el.value).toBe('b')
  })

  it('applies base border when valid', () => {
    render(
      <Select aria-label="pick">
        <option value="a">A</option>
      </Select>,
    )
    const el = screen.getByRole('combobox', { name: 'pick' })
    expect(el.className).toMatch(/border-border/)
  })

  it('applies error border when aria-invalid', () => {
    render(
      <Select aria-label="pick" aria-invalid="true">
        <option value="a">A</option>
      </Select>,
    )
    const el = screen.getByRole('combobox', { name: 'pick' })
    expect(el.className).toMatch(/border-danger/)
    expect(el.className).toMatch(/focus-visible:ring-danger/)
  })

  it('forwards className + ref', () => {
    const ref = React.createRef<HTMLSelectElement>()
    render(
      <Select ref={ref} className="x-extra" aria-label="pick">
        <option value="a">A</option>
      </Select>,
    )
    const el = screen.getByRole('combobox', { name: 'pick' })
    expect(el.className).toMatch(/x-extra/)
    expect(ref.current).toBeInstanceOf(HTMLSelectElement)
  })
})
