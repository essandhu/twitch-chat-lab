import * as RadixTooltip from '@radix-ui/react-tooltip'
import * as React from 'react'
import { cn } from '../../lib/cn'

type ProviderProps = React.ComponentPropsWithoutRef<typeof RadixTooltip.Provider>

export const TooltipProvider = ({
  delayDuration = 200,
  children,
  ...props
}: ProviderProps) => (
  <RadixTooltip.Provider delayDuration={delayDuration} {...props}>
    {children}
  </RadixTooltip.Provider>
)

type ContentProps = React.ComponentPropsWithoutRef<typeof RadixTooltip.Content>

type TooltipProps = {
  content: React.ReactNode
  children: React.ReactNode
  side?: ContentProps['side']
  align?: ContentProps['align']
  className?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export const Tooltip = ({
  content,
  children,
  side,
  align,
  className,
  open,
  defaultOpen,
  onOpenChange,
}: TooltipProps) => (
  <RadixTooltip.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
    <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        side={side}
        align={align}
        sideOffset={4}
        className={cn(
          'bg-surface-raised text-text px-2 py-1 rounded-md border border-border shadow-lg text-xs z-50',
          className,
        )}
      >
        {content}
        <RadixTooltip.Arrow className="fill-[rgb(var(--surface-raised))]" />
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  </RadixTooltip.Root>
)
