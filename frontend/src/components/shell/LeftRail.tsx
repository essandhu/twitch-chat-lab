import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { Avatar } from '../ui/Avatar'
import { Tooltip } from '../ui/Tooltip'
import { useIsBelow } from '../../hooks/useIsBelow'
import { useMultiStreamStore } from '../../store/multiStreamStore'

const STORAGE_KEY = 'tcl.rail.collapsed'

const readPersistedCollapsed = (): boolean | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
  } catch {
    return null
  }
}

const readInitialCollapsed = (autoCollapse: boolean): boolean => {
  const persisted = readPersistedCollapsed()
  if (persisted !== null) return persisted
  return autoCollapse
}

const isEditableTarget = (el: Element | null): boolean => {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 6.5 8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5Z" />
    <path d="M6.5 14V9h3v5" />
  </svg>
)

const FollowedIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 14s-5-3.2-5-7a3 3 0 0 1 5-2.2A3 3 0 0 1 13 7c0 3.8-5 7-5 7Z" />
  </svg>
)

const BrowseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6h12" />
  </svg>
)

const ChevronIcon = ({ collapsed }: { collapsed: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: collapsed ? 'rotate(180deg)' : 'none' }}>
    <path d="M10 4 6 8l4 4" />
  </svg>
)

type NavButtonProps = {
  label: string
  icon: ReactNode
  collapsed: boolean
  active?: boolean
  disabled?: boolean
  disabledTooltip?: string
  onClick?: () => void
}

const NavButton = ({ label, icon, collapsed, active, disabled, disabledTooltip, onClick }: NavButtonProps) => {
  const button = (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center gap-3 h-10 px-3 rounded-md text-text-muted transition-colors',
        'hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active && 'text-text bg-accent/10',
        collapsed && 'justify-center',
      )}
    >
      {active && (
        <span className="absolute inset-y-2 left-0 w-0.5 rounded-r bg-accent" aria-hidden="true" />
      )}
      <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )

  if (collapsed || (disabled && disabledTooltip)) {
    return (
      <Tooltip content={disabled && disabledTooltip ? disabledTooltip : label} side="right">
        <span className="block">{button}</span>
      </Tooltip>
    )
  }
  return button
}

type TrackedRowProps = {
  displayName: string
  collapsed: boolean
}

const TrackedRow = ({ displayName, collapsed }: TrackedRowProps) => {
  const letter = displayName.charAt(0).toUpperCase()
  const row = (
    <button
      type="button"
      className={cn(
        'flex items-center gap-3 h-12 px-3 w-full text-left rounded-md transition-colors',
        'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        collapsed && 'justify-center',
      )}
    >
      <Avatar.Root className="h-8 w-8 shrink-0">
        <Avatar.Fallback>{letter}</Avatar.Fallback>
      </Avatar.Root>
      {!collapsed && (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-text">{displayName}</span>
          <span className="truncate text-xs text-text-muted">&nbsp;</span>
        </span>
      )}
    </button>
  )

  if (collapsed) {
    return (
      <Tooltip content={displayName} side="right">
        <span className="block">{row}</span>
      </Tooltip>
    )
  }
  return row
}

export const LeftRail = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const streams = useMultiStreamStore((s) => s.streams)
  const shouldAutoCollapse = useIsBelow(1280)
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readInitialCollapsed(shouldAutoCollapse),
  )

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  useEffect(() => {
    // Ctrl+B (not Cmd+B) on all platforms — avoids macOS rich-text "bold" conflict.
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey)) return
      if (e.key.toLowerCase() !== 'b') return
      if (isEditableTarget(document.activeElement)) return
      e.preventDefault()
      toggleCollapsed()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const isHomeActive = location.pathname === '/'
  const trackedEntries = Object.values(streams)

  return (
    <div
      data-shell-section="left-rail"
      style={{ width: collapsed ? 60 : 240 }}
      className={cn(
        'bg-surface border-r border-border h-full overflow-y-auto flex flex-col',
        'transition-[width] duration-150 ease-out',
      )}
    >
      <nav className="flex flex-col gap-1 p-2">
        <NavButton
          label="Home"
          icon={<HomeIcon />}
          collapsed={collapsed}
          active={isHomeActive}
          onClick={() => navigate('/')}
        />
        <NavButton
          label="Followed"
          icon={<FollowedIcon />}
          collapsed={collapsed}
          disabled
          disabledTooltip="Coming soon"
        />
        <NavButton
          label="Browse"
          icon={<BrowseIcon />}
          collapsed={collapsed}
          disabled
          disabledTooltip="Coming soon"
        />
      </nav>

      <div className="flex-1 overflow-y-auto">
        {!collapsed && (
          <div className="px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-text-muted">
            TRACKED
          </div>
        )}
        <div className="flex flex-col gap-0.5 p-2">
          {trackedEntries.map((s) => (
            <TrackedRow key={s.login} displayName={s.displayName} collapsed={collapsed} />
          ))}
        </div>
      </div>

      <div className="border-t border-border p-2">
        <Tooltip
          content={collapsed ? 'Expand rail (Ctrl+B)' : 'Collapse rail (Ctrl+B)'}
          side="right"
        >
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand rail (Ctrl+B)' : 'Collapse rail (Ctrl+B)'}
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-2 text-text-muted transition-colors',
              'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              collapsed ? 'w-full justify-center' : 'w-auto',
            )}
          >
            <ChevronIcon collapsed={collapsed} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
