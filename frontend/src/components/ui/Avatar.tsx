import * as RadixAvatar from '@radix-ui/react-avatar'
import * as React from 'react'
import { cn } from '../../lib/cn'

type RootProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Root>
type ImageProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Image>
type FallbackProps = React.ComponentPropsWithoutRef<typeof RadixAvatar.Fallback>

// The shimmer is a negative-z-index sibling of Image/Fallback so the pulse
// animates only the shimmer layer — not Root itself. A pulse applied to Root
// would cascade its opacity animation down into every child (including a
// loaded Image), which previously made the profile picture keep pulsing.
// `isolate` keeps the negative z-index contained within Root's stacking
// context. Once Image loads or Fallback mounts, their opaque backgrounds
// cover the shimmer — it never shows through for letter-only avatars.
const AvatarRoot = React.forwardRef<
  React.ElementRef<typeof RadixAvatar.Root>,
  RootProps
>(({ className, children, ...props }, ref) => (
  <RadixAvatar.Root
    ref={ref}
    className={cn(
      'relative isolate h-8 w-8 rounded-full overflow-hidden inline-block',
      className,
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className="absolute inset-0 -z-10 bg-surface-hover motion-safe:animate-pulse"
    />
    {children}
  </RadixAvatar.Root>
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
