import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../ThemeProvider'
import { SafeModeProvider } from '../SafeModeProvider'
import { useTheme } from '../../hooks/useTheme'
import { PENDING_CHANNEL_KEY } from '../../features/auth/ConnectForm'
import { TooltipProvider } from '../ui/Tooltip'

vi.mock('../../features/auth/authServices', () => ({
  twitchAuthService: {
    authorize: vi.fn(),
    getToken: vi.fn().mockReturnValue(null),
    clearToken: vi.fn(),
  },
}))

vi.mock('../../services/DemoModeService', async () => {
  const actual = await vi.importActual<typeof import('../../services/DemoModeService')>(
    '../../services/DemoModeService',
  )
  return {
    ...actual,
    isDemoMode: vi.fn().mockReturnValue(false),
  }
})

// Import after mocks
import { TopNav } from './TopNav'
import { twitchAuthService } from '../../features/auth/authServices'
import { isDemoMode } from '../../services/DemoModeService'

const getAuth = () => twitchAuthService as unknown as {
  authorize: ReturnType<typeof vi.fn>
  getToken: ReturnType<typeof vi.fn>
  clearToken: ReturnType<typeof vi.fn>
}

const getDemo = () => isDemoMode as unknown as ReturnType<typeof vi.fn>

const LocationProbe = () => {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname}</div>
}

const ThemeProbe = () => {
  const { theme, resolvedTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
    </div>
  )
}

const renderNav = (extra?: React.ReactNode, initialEntries: string[] = ['/somewhere']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider>
        <SafeModeProvider>
          <TooltipProvider delayDuration={0}>
            <TopNav />
            <LocationProbe />
            <ThemeProbe />
            {extra}
          </TooltipProvider>
        </SafeModeProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  getAuth().authorize.mockClear()
  getAuth().clearToken.mockClear()
  getAuth().getToken.mockReturnValue(null)
  getDemo().mockReturnValue(false)
  localStorage.clear()
  sessionStorage.removeItem(PENDING_CHANNEL_KEY)
  document.documentElement.removeAttribute('data-theme')
  // Provide matchMedia for ThemeProvider
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TopNav', () => {
  it('renders wordmark, search input, theme toggle, and auth-menu trigger', () => {
    renderNav()
    expect(screen.getByText('twitch · chat · lab')).toBeInTheDocument()
    expect(screen.getByLabelText('Channel search')).toBeInTheDocument()
    expect(screen.getByLabelText(/theme/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/safe mode/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/account menu/i)).toBeInTheDocument()
  })

  it('safe-mode toggle flips state and persists to localStorage', async () => {
    const user = userEvent.setup()
    renderNav()
    const toggle = screen.getByLabelText(/safe mode/i)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    expect(screen.getByLabelText(/safe mode/i)).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('tcl.safe-mode')).toBe('true')
    await user.click(screen.getByLabelText(/safe mode/i))
    expect(screen.getByLabelText(/safe mode/i)).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('tcl.safe-mode')).toBe('false')
  })

  it('pressing "/" focuses the search input when not in a form field', () => {
    renderNav()
    const search = screen.getByLabelText('Channel search')
    expect(document.activeElement).not.toBe(search)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    })
    // Fallback: dispatch on document too
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(search)
  })

  it('pressing "/" does NOT steal focus when another input is focused', () => {
    renderNav(<input data-testid="other" />)
    const other = screen.getByTestId('other') as HTMLInputElement
    other.focus()
    expect(document.activeElement).toBe(other)
    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(other)
  })

  it('toggle flips between dark and light based on resolved theme', async () => {
    const user = userEvent.setup()
    renderNav()
    const toggle = screen.getByLabelText(/theme/i)

    // Start as system; matchMedia mock returns matches=false, so resolved=light.
    expect(screen.getByTestId('theme').textContent).toBe('system')
    expect(screen.getByTestId('resolved').textContent).toBe('light')

    // First click flips to the opposite of resolved — dark.
    await user.click(toggle)
    expect(screen.getByTestId('theme').textContent).toBe('dark')

    // Every subsequent click flips: dark -> light -> dark.
    await user.click(toggle)
    expect(screen.getByTestId('theme').textContent).toBe('light')
    await user.click(toggle)
    expect(screen.getByTestId('theme').textContent).toBe('dark')
  })

  it('clicking the wordmark navigates to /', async () => {
    const user = userEvent.setup()
    renderNav(undefined, ['/somewhere'])
    expect(screen.getByTestId('location').textContent).toBe('/somewhere')
    await user.click(screen.getByText('twitch · chat · lab'))
    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('unauthed auth menu shows "Sign in with Twitch" and clicking calls authorize()', async () => {
    getAuth().getToken.mockReturnValue(null)
    getDemo().mockReturnValue(false)
    renderNav()
    const trigger = screen.getByLabelText(/account menu/i)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByText('Sign in with Twitch')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Sign in with Twitch'))
    expect(getAuth().authorize).toHaveBeenCalledTimes(1)
  })

  it('authed auth menu shows "Sign out" and clicking calls clearToken()', async () => {
    getAuth().getToken.mockReturnValue('abc')
    renderNav()
    const trigger = screen.getByLabelText(/account menu/i)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByText('Sign out')).toBeInTheDocument()
    })
    expect(screen.getByText('Signed in')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Sign out'))
    expect(getAuth().clearToken).toHaveBeenCalledTimes(1)
  })

  it('demo-mode auth menu shows "Demo mode" label and "Sign in with Twitch"', async () => {
    getAuth().getToken.mockReturnValue(null)
    getDemo().mockReturnValue(true)
    renderNav()
    const trigger = screen.getByLabelText(/account menu/i)
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    await waitFor(() => {
      expect(screen.getByText('Demo mode')).toBeInTheDocument()
    })
    expect(screen.getByText('Sign in with Twitch')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Sign in with Twitch'))
    expect(getAuth().authorize).toHaveBeenCalledTimes(1)
  })

  it('unauthed search submit calls authorize() and stashes channel in sessionStorage', async () => {
    const user = userEvent.setup()
    getAuth().getToken.mockReturnValue(null)
    renderNav()
    const input = screen.getByLabelText('Channel search') as HTMLInputElement
    await user.type(input, 'shroud{Enter}')
    expect(getAuth().authorize).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem(PENDING_CHANNEL_KEY)).toBe('shroud')
  })

  it('authed search submit dispatches tcl.reconnect CustomEvent', async () => {
    const user = userEvent.setup()
    getAuth().getToken.mockReturnValue('abc')
    const handler = vi.fn()
    window.addEventListener('tcl.reconnect', handler as EventListener)
    renderNav()
    const input = screen.getByLabelText('Channel search') as HTMLInputElement
    await user.type(input, 'xqc{Enter}')
    expect(handler).toHaveBeenCalledTimes(1)
    const evt = handler.mock.calls[0][0] as CustomEvent<{ channel: string }>
    expect(evt.detail).toEqual({ channel: 'xqc' })
    expect(getAuth().authorize).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(PENDING_CHANNEL_KEY)).toBe('xqc')
    window.removeEventListener('tcl.reconnect', handler as EventListener)
  })
})
