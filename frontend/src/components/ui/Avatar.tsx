import * as RadixAvatar from '@radix-ui/react-avatar'
import * as React from 'react'
import { cn } from '../../lib/cn'

type RootProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Root>
type ImageProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Image>
type FallbackProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Fallback>

const AvatarRoot = React.forwardRef<
  React.ElementRef<typeof RadixAvatar.Root>,
  RootProps
>(({ className, ...props }, ref) => (
  <RadixAvatar.Root
    ref={ref}
    className={cn(
      'h-8 w-8 rounded-full overflow-hidden inline-block',
      className,
    )}
    {...props}
  />
))
AvatarRoot.displayName = 'Avatar.Root'

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof RadixAvatar.Image>,
  ImageProps
>(({ className, ...props }, ref) => (
  <RadixAvatar.Image
    ref={ref}
    className={cn('h-full w-full object-cover', className)}
    {...props}
  />
))
AvatarImage.displayName = 'Avatar.Image'

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof RadixAvatar.Fallback>,
  FallbackProps
>(({ className, ...props }, ref) => (
  <RadixAvatar.Fallback
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center bg-surface-hover text-text-muted text-xs font-medium h-full w-full',
      className,
    )}
    {...props}
  />
))
AvatarFallback.displayName = 'Avatar.Fallback'

export const Avatar = {
  Root: AvatarRoot,
  Image: AvatarImage,
  Fallback: AvatarFallback,
}
