import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../../lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-surface-hover text-text-muted',
        accent: 'bg-accent/20 text-accent',
        success: 'bg-success/20 text-success',
        danger: 'bg-danger/20 text-danger',
        warning: 'bg-warning/20 text-warning',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  ),
)
Badge.displayName = 'Badge'
