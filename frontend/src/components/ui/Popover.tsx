import * as RadixPopover from '@radix-ui/react-popover'
import * as React from 'react'
import { cn } from '../../lib/cn'

export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger
export const PopoverAnchor = RadixPopover.Anchor

type ContentProps = React.ComponentPropsWithoutRef<typeof RadixPopover.Content>

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof RadixPopover.Content>,
  ContentProps
>(({ className, align = 'center', sideOffset = 6, ...props }, ref) => (
  <RadixPopover.Portal>
    <RadixPopover.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 rounded-md border border-border bg-surface-raised p-3 shadow-lg',
        'focus:outline-none',
        className,
      )}
      {...props}
    />
  </RadixPopover.Portal>
))
PopoverContent.displayName = 'PopoverContent'
