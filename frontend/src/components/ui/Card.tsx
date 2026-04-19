import * as React from 'react'
import { cn } from '../../lib/cn'

type DivProps = React.HTMLAttributes<HTMLDivElement>

type CardProps = DivProps & {
  elevated?: boolean
}

const CardRoot = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevated = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        elevated ? 'bg-surface-raised' : 'bg-surface',
        'border border-border rounded-lg',
        className,
      )}
      {...props}
    />
  ),
)
CardRoot.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('px-4 py-3 border-b border-border', className)}
      {...props}
    />
  ),
)
CardHeader.displayName = 'Card.Header'

const CardBody = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4', className)} {...props} />
  ),
)
CardBody.displayName = 'Card.Body'

const CardFooter = React.forwardRef<HTMLDivElement, DivProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'px-4 py-3 border-t border-border flex items-center justify-end gap-2',
        className,
      )}
      {...props}
    />
  ),
)
CardFooter.displayName = 'Card.Footer'

type CardCompound = typeof CardRoot & {
  Header: typeof CardHeader
  Body: typeof CardBody
  Footer: typeof CardFooter
}

export const Card = CardRoot as CardCompound
Card.Header = CardHeader
Card.Body = CardBody
Card.Footer = CardFooter
