import type { ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { cn } from '../../lib/cn'

export type MobileSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  side: 'left' | 'bottom'
  title: string
  children: ReactNode
  contentTestId?: string
}

/**
 * Hand-rolled sheet on top of RadixDialog primitives. We can't use the
 * shared `Dialog.Content` wrapper here because it hard-codes centered
 * positioning; sheets need edge-anchored, full-height/width positioning
 * that would fight the wrapper's classes.
 */
export const MobileSheet = ({
  open,
  onOpenChange,
  side,
  title,
  children,
  contentTestId,
}: MobileSheetProps) => (
  <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-bg/80 backdrop-blur-sm z-50" />
      <RadixDialog.Content
        data-testid={contentTestId}
        className={cn(
          'fixed z-50 bg-surface border-border shadow-xl focus:outline-none',
          side === 'left' &&
            'left-0 top-0 bottom-0 h-full w-[min(80vw,280px)] border-r',
          side === 'bottom' &&
            'left-0 right-0 bottom-0 w-full max-w-full h-full border-t',
        )}
      >
        <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
        <div className="h-full w-full overflow-hidden flex flex-col">
          {children}
        </div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>
)
