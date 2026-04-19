import { forwardRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type MainPaneProps = {
  children: ReactNode
  className?: string
}

export const MainPane = forwardRef<HTMLDivElement, MainPaneProps>(
  ({ children, className }, ref) => (
    <div
      ref={ref}
      data-shell-section="main-pane-inner"
      className={cn('flex min-h-0 flex-col overflow-hidden', className)}
    >
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  ),
)
MainPane.displayName = 'MainPane'
