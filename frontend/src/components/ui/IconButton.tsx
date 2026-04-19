import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../../lib/cn'
import { Tooltip } from './Tooltip'

const iconButtonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
        secondary:
          'bg-surface text-text hover:bg-surface-hover border border-border',
        ghost: 'bg-transparent text-text hover:bg-surface-hover',
        danger: 'bg-danger text-white hover:brightness-110',
      },
      size: {
        sm: 'h-8 w-8',
        md: 'h-9 w-9',
        lg: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'md',
    },
  },
)

export type IconButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> &
  VariantProps<typeof iconButtonVariants> & {
    tooltip?: string
    'aria-label'?: string
  }

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, tooltip, children, ...props }, ref) => {
    const ariaLabel = props['aria-label'] ?? tooltip
    const btn = (
      <button
        ref={ref}
        aria-label={ariaLabel}
        className={cn(iconButtonVariants({ variant, size }), className)}
        {...props}
      >
        {children}
      </button>
    )
    return tooltip ? <Tooltip content={tooltip}>{btn}</Tooltip> : btn
  },
)
IconButton.displayName = 'IconButton'
