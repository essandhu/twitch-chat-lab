import * as React from 'react'
import { cn } from '../../lib/cn'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

const BASE =
  'w-full h-9 px-3 rounded-md bg-surface text-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 text-sm border'

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => {
    const invalid =
      props['aria-invalid'] === true || props['aria-invalid'] === 'true'
    return (
      <select
        ref={ref}
        className={cn(
          BASE,
          invalid
            ? 'border-danger focus-visible:ring-danger'
            : 'border-border focus-visible:ring-accent',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    )
  },
)
Select.displayName = 'Select'
