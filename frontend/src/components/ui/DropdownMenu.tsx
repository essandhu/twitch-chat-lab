import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu'
import * as React from 'react'
import { cn } from '../../lib/cn'

type ContentProps = React.ComponentPropsWithoutRef<
  typeof RadixDropdownMenu.Content
>
type ItemProps = React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Item>
type SeparatorProps = React.ComponentPropsWithoutRef<
  typeof RadixDropdownMenu.Separator
>
type LabelProps = React.ComponentPropsWithoutRef<typeof RadixDropdownMenu.Label>

const DropdownContent = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Content>,
  ContentProps
>(({ className, sideOffset = 4, ...props }, ref) => (
  <RadixDropdownMenu.Portal>
    <RadixDropdownMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'bg-surface-raised border border-border rounded-md shadow-lg p-1 min-w-[8rem] z-50',
        className,
      )}
      {...props}
    />
  </RadixDropdownMenu.Portal>
))
DropdownContent.displayName = 'DropdownMenu.Content'

const DropdownItem = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Item>,
  ItemProps
>(({ className, ...props }, ref) => (
  <RadixDropdownMenu.Item
    ref={ref}
    className={cn(
      'px-2 py-1.5 text-sm rounded-sm cursor-pointer text-text data-[highlighted]:bg-surface-hover data-[highlighted]:outline-none',
      className,
    )}
    {...props}
  />
))
DropdownItem.displayName = 'DropdownMenu.Item'

const DropdownSeparator = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Separator>,
  SeparatorProps
>(({ className, ...props }, ref) => (
  <RadixDropdownMenu.Separator
    ref={ref}
    className={cn('h-px bg-border my-1', className)}
    {...props}
  />
))
DropdownSeparator.displayName = 'DropdownMenu.Separator'

const DropdownLabel = React.forwardRef<
  React.ElementRef<typeof RadixDropdownMenu.Label>,
  LabelProps
>(({ className, ...props }, ref) => (
  <RadixDropdownMenu.Label
    ref={ref}
    className={cn('px-2 py-1 text-xs text-text-muted', className)}
    {...props}
  />
))
DropdownLabel.displayName = 'DropdownMenu.Label'

export const DropdownMenu = {
  Root: RadixDropdownMenu.Root,
  Trigger: RadixDropdownMenu.Trigger,
  Content: DropdownContent,
  Item: DropdownItem,
  Separator: DropdownSeparator,
  Label: DropdownLabel,
}
