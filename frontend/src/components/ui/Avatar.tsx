import * as RadixAvatar from '@radix-ui/react-avatar'
import * as React from 'react'
import { cn } from '../../lib/cn'

type RootProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Root>
type ImageProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Image>
type FallbackProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Fallback>

// Root wears a pulsing placeholder background that is only visible in the
// narrow window where Radix has mounted the Image but the network hasn't
// produced a loaded status yet. Once Image resolves, it covers the Root;
// once Fallback resolves (error / no Image child), its own solid bg covers
// the Root. So this shimmer shows for loading real URLs only — letter-only
// avatars never flash.
const AvatarRoot = React.forwardRef<
  React.ElementRef<typeof RadixAvatar.Root>,
  RootProps
>(({ className, ...props }, ref) => (
  <RadixAvatar.Root
    ref={ref}
    className={cn(
      'h-8 w-8 rounded-full overflow-hidden inline-block bg-surface-hover motion-safe:animate-pulse',
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

// Callers that also render an Avatar.Image should pass delayMs (e.g. 400) so
// the Root's shimmer bg is briefly visible during the image load window
// before this fallback replaces it. Callers without an Image want the
// default (0) so the letter renders immediately.
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
