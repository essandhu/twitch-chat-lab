import * as RadixToast from '@radix-ui/react-toast'
import * as React from 'react'
import { cn } from '../../lib/cn'

type ProviderProps = React.ComponentPropsWithoutRef<typeof RadixToast.Provider>
type RootProps = React.ComponentPropsWithoutRef<typeof RadixToast.Root>
type TitleProps = React.ComponentPropsWithoutRef<typeof RadixToast.Title>
type DescriptionProps = React.ComponentPropsWithoutRef<
  typeof RadixToast.Description
>
type ActionProps = React.ComponentPropsWithoutRef<typeof RadixToast.Action>
type CloseProps = React.ComponentPropsWithoutRef<typeof RadixToast.Close>

export const ToastProvider = ({ children, ...props }: ProviderProps) => (
  <RadixToast.Provider {...props}>
    {children}
    <RadixToast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 z-[100] outline-none" />
  </RadixToast.Provider>
)

const ToastRoot = React.forwardRef<
  React.ElementRef<typeof RadixToast.Root>,
  RootProps
>(({ className, ...props }, ref) => (
  <RadixToast.Root
    ref={ref}
    className={cn(
      'bg-surface-raised border border-border rounded-md shadow-lg p-4 data-[state=open]:animate-in data-[state=closed]:animate-out',
      className,
    )}
    {...props}
  />
))
ToastRoot.displayName = 'Toast.Root'

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof RadixToast.Title>,
  TitleProps
>(({ className, ...props }, ref) => (
  <RadixToast.Title
    ref={ref}
    className={cn('text-sm font-semibold text-text', className)}
    {...props}
  />
))
ToastTitle.displayName = 'Toast.Title'

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof RadixToast.Description>,
  DescriptionProps
>(({ className, ...props }, ref) => (
  <RadixToast.Description
    ref={ref}
    className={cn('text-xs text-text-muted mt-1', className)}
    {...props}
  />
))
ToastDescription.displayName = 'Toast.Description'

const ToastAction = React.forwardRef<
  React.ElementRef<typeof RadixToast.Action>,
  ActionProps
>(({ className, ...props }, ref) => (
  <RadixToast.Action
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  />
))
ToastAction.displayName = 'Toast.Action'

const ToastClose = React.forwardRef<
  React.ElementRef<typeof RadixToast.Close>,
  CloseProps
>(({ className, ...props }, ref) => (
  <RadixToast.Close
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-md text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  />
))
ToastClose.displayName = 'Toast.Close'

export const Toast = {
  Root: ToastRoot,
  Title: ToastTitle,
  Description: ToastDescription,
  Action: ToastAction,
  Close: ToastClose,
}
