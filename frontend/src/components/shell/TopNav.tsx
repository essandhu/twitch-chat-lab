import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { IconButton } from '../ui/IconButton'
import { Input } from '../ui/Input'
import { DropdownMenu } from '../ui/DropdownMenu'
import { useTheme } from '../../hooks/useTheme'
import type { ThemeChoice } from '../ThemeProvider'
import { twitchAuthService } from '../../features/auth/authServices'
import { isDemoMode } from '../../services/DemoModeService'
import { PENDING_CHANNEL_KEY } from '../../features/auth/ConnectForm'

// --- Icons (inline 16x16 SVGs; stroke-based, use currentColor) -----------
const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const SunIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </Svg>
)

const MoonIcon = () => (
  <Svg>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </Svg>
)

const MonitorIcon = () => (
  <Svg>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
)

const UserIcon = () => (
  <Svg>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Svg>
)

const nextTheme = (current: ThemeChoice): ThemeChoice => {
  if (current === 'system') return 'dark'
  if (current === 'dark') return 'light'
  return 'system'
}

const isFormFieldFocused = (): boolean => {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return false
}

export type TopNavProps = {
  /**
   * Optional leading element rendered at the far left of the TopNav flow, before
   * the wordmark. AppShell passes a hamburger IconButton here in mobile layout.
   */
  leadingRailTrigger?: ReactNode
}

export const TopNav = ({ leadingRailTrigger }: TopNavProps = {}) => {
  const navigate = useNavigate()
  const { theme, setTheme, resolvedTheme } = useTheme()
  const searchRef = useRef<HTMLInputElement>(null)
  const [channel, setChannel] = useState('')

  // Derive auth-state snapshot per render so menu items reflect current state.
  const token = twitchAuthService.getToken()
  const authed = token !== null
  const demo = isDemoMode()

  useEffect(() => {
    // "/" focus shortcut — skipped inside form fields; preventDefault avoids
    // Firefox's built-in quick-find trigger on "/".
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isFormFieldFocused()) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = channel.trim().toLowerCase()
    if (!trimmed) return
    sessionStorage.setItem(PENDING_CHANNEL_KEY, trimmed)
    if (twitchAuthService.getToken() !== null) {
      window.dispatchEvent(
        new CustomEvent('tcl.reconnect', { detail: { channel: trimmed } }),
      )
    } else {
      twitchAuthService.authorize()
    }
  }

  const cycleTheme = () => setTheme(nextTheme(theme))

  const ThemeIcon = () => {
    if (theme === 'system') return <MonitorIcon />
    return resolvedTheme === 'dark' ? <MoonIcon /> : <SunIcon />
  }

  return (
    <nav
      data-top-nav
      className="h-14 bg-surface border-b border-border flex items-center px-4 gap-4 w-full"
    >
      {leadingRailTrigger}
      {/* Left: wordmark */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className={cn(
          'rounded-md px-2 py-1 bg-transparent border-0 cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        )}
      >
        <span className="font-mono text-xs uppercase tracking-[0.22em] text-text-muted hover:text-text transition-colors">
          twitch · chat · lab
        </span>
      </button>

      {/* Center: search */}
      <div className="flex-1 flex justify-center">
        <form onSubmit={onSubmit} className="w-full max-w-md">
          <Input
            ref={searchRef}
            type="text"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="Search a Twitch channel…"
            aria-label="Channel search"
            autoComplete="off"
            spellCheck={false}
          />
        </form>
      </div>

      {/* Right: theme toggle + account menu */}
      <div className="flex items-center gap-2">
        <IconButton
          variant="ghost"
          size="md"
          aria-label={`Theme: ${theme}`}
          onClick={cycleTheme}
        >
          <ThemeIcon />
        </IconButton>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton variant="ghost" size="md" aria-label="Account menu">
              <UserIcon />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            {authed && (
              <>
                <DropdownMenu.Label>Signed in</DropdownMenu.Label>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onSelect={() => twitchAuthService.clearToken()}
                >
                  Sign out
                </DropdownMenu.Item>
              </>
            )}
            {!authed && demo && (
              <>
                <DropdownMenu.Label>Demo mode</DropdownMenu.Label>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  onSelect={() => twitchAuthService.authorize()}
                >
                  Sign in with Twitch
                </DropdownMenu.Item>
              </>
            )}
            {!authed && !demo && (
              <DropdownMenu.Item
                onSelect={() => twitchAuthService.authorize()}
              >
                Sign in with Twitch
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </nav>
  )
}
