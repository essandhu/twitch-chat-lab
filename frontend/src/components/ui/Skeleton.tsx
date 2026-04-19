import * as React from 'react'
import { cn } from '../../lib/cn'

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'bg-surface-hover rounded-md motion-safe:animate-pulse',
        className,
      )}
      {...props}
    />
  ),
)
Skeleton.displayName = 'Skeleton'
