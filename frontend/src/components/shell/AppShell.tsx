import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ThemeProvider } from '../ThemeProvider'
import { SafeModeProvider } from '../SafeModeProvider'
import { TooltipProvider } from '../ui/Tooltip'
import { ToastProvider } from '../ui/Toast'
import { IconButton } from '../ui/IconButton'
import { MobileSheet } from './MobileSheet'
import { HamburgerIcon, ChatBubbleIcon } from './shellIcons'
import {
  useReducedMotion,
  useResponsiveLayout,
  withDockDefaultWidth,
  withLeadingRailTrigger,
} from './shellLayout'

export type AppShellProps = {
  top: ReactNode
  rail: ReactNode
  main: ReactNode
  dock: ReactNode
}

type ShellSectionProps = {
  top: ReactNode
  rail: ReactNode
  main: ReactNode
  dock: ReactNode
  reducedMotion: boolean
  firstMount: boolean
}

const firstMountAttr = (firstMount: boolean) =>
  firstMount ? { 'data-first-mount': 'true' } : {}

const MobileShell = ({
  top,
  rail,
  main,
  dock,
  reducedMotion,
  firstMount,
}: ShellSectionProps) => {
  const [railOpen, setRailOpen] = useState(false)
  const [dockOpen, setDockOpen] = useState(false)

  const hamburger = (
    <IconButton
      variant="ghost"
      size="md"
      aria-label="Open navigation"
      onClick={() => setRailOpen(true)}
    >
      <HamburgerIcon />
    </IconButton>
  )

  return (
    <div
      data-app-shell
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-layout="mobile"
      className="grid h-full w-full"
      style={{ gridTemplateRows: '56px 1fr', gridTemplateColumns: '1fr' }}
    >
      <div
        data-shell-section="top-nav"
        style={{ gridRow: '1' }}
        {...firstMountAttr(firstMount)}
      >
        {withLeadingRailTrigger(top, hamburger)}
      </div>
      <div
        data-shell-section="main-pane"
        style={{ gridRow: '2' }}
        className="min-h-0 min-w-0"
        {...firstMountAttr(firstMount)}
      >
        {main}
      </div>
      <IconButton
        variant="primary"
        size="lg"
        aria-label="Open chat"
        onClick={() => setDockOpen(true)}
        className="fixed bottom-4 right-4 z-40 shadow-lg"
      >
        <ChatBubbleIcon />
      </IconButton>
      <MobileSheet
        open={railOpen}
        onOpenChange={setRailOpen}
        side="left"
        title="Navigation"
        contentTestId="mobile-rail-sheet"
      >
        {rail}
      </MobileSheet>
      <MobileSheet
        open={dockOpen}
        onOpenChange={setDockOpen}
        side="bottom"
        title="Chat"
        contentTestId="mobile-dock-sheet"
      >
        {dock}
      </MobileSheet>
    </div>
  )
}

const DesktopShell = ({
  top,
  rail,
  main,
  dock,
  reducedMotion,
  firstMount,
}: ShellSectionProps) => (
  <div
    data-app-shell
    data-reduced-motion={reducedMotion ? 'true' : 'false'}
    data-layout="desktop"
    className="grid h-full w-full"
    style={{
      gridTemplateRows: '56px 1fr',
      gridTemplateColumns: 'auto 1fr auto',
    }}
  >
    <div
      data-shell-section="top-nav"
      style={{ gridColumn: '1 / -1', gridRow: '1' }}
      {...firstMountAttr(firstMount)}
    >
      {top}
    </div>
    <div
      data-shell-section="left-rail"
      style={{ gridColumn: '1', gridRow: '2' }}
      className="min-h-0"
      {...firstMountAttr(firstMount)}
    >
      {rail}
    </div>
    <div
      data-shell-section="main-pane"
      style={{ gridColumn: '2', gridRow: '2' }}
      className="min-h-0 min-w-0"
      {...firstMountAttr(firstMount)}
    >
      {main}
    </div>
    <div
      data-shell-section="chat-dock"
      style={{ gridColumn: '3', gridRow: '2' }}
      className="min-h-0"
      {...firstMountAttr(firstMount)}
    >
      {dock}
    </div>
  </div>
)

export const AppShell = ({ top, rail, main, dock }: AppShellProps) => {
  const reducedMotion = useReducedMotion()
  const { isMobile, dockDefaultWidth } = useResponsiveLayout()
  const dockWithDefault = withDockDefaultWidth(dock, dockDefaultWidth)

  const firstMountRef = useRef(true)
  const [firstMount, setFirstMount] = useState(true)
  useEffect(() => {
    if (!firstMountRef.current) return
    firstMountRef.current = false
    const timer = window.setTimeout(() => setFirstMount(false), 800)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <ThemeProvider>
      <SafeModeProvider>
        <TooltipProvider>
          <ToastProvider>
            {isMobile ? (
              <MobileShell
                top={top}
                rail={rail}
                main={main}
                dock={dockWithDefault}
                reducedMotion={reducedMotion}
                firstMount={firstMount}
              />
            ) : (
              <DesktopShell
                top={top}
                rail={rail}
                main={main}
                dock={dockWithDefault}
                reducedMotion={reducedMotion}
                firstMount={firstMount}
              />
            )}
          </ToastProvider>
        </TooltipProvider>
      </SafeModeProvider>
    </ThemeProvider>
  )
}
