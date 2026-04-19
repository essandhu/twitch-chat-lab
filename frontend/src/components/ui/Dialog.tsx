import * as RadixDialog from '@radix-ui/react-dialog'
import * as React from 'react'
import { cn } from '../../lib/cn'

type ContentProps = React.ComponentPropsWithoutRef<typeof RadixDialog.Content>
type TitleProps = React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
type DescriptionProps = React.ComponentPropsWithoutRef<
  typeof RadixDialog.Description
>

const DialogContent = React.forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  ContentProps
>(({ className, children, ...props }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-50" />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-surface-raised border border-border rounded-lg shadow-xl p-6 max-w-lg w-full',
        className,
      )}
      {...props}
    >
      {children}
      <RadixDialog.Close
        aria-label="Close"
        className="absolute top-3 right-3 inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        ×
      </RadixDialog.Close>
    </RadixDialog.Content>
  </RadixDialog.Portal>
))
DialogContent.displayName = 'Dialog.Content'

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  TitleProps
>(({ className, ...props }, ref) => (
  <RadixDialog.Title
    ref={ref}
    className={cn('text-lg font-semibold text-text mb-1', className)}
    {...props}
  />
))
DialogTitle.displayName = 'Dialog.Title'

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof RadixDialog.Description>,
  DescriptionProps
>(({ className, ...props }, ref) => (
  <RadixDialog.Description
    ref={ref}
    className={cn('text-sm text-text-muted mb-4', className)}
    {...props}
  />
))
DialogDescription.displayName = 'Dialog.Description'

export const Dialog = {
  Root: RadixDialog.Root,
  Trigger: RadixDialog.Trigger,
  Close: RadixDialog.Close,
  Content: DialogContent,
  Title: DialogTitle,
  Description: DialogDescription,
}
