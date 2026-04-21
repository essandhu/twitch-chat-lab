import { Dialog } from '../../components/ui/Dialog'
import { useSemanticStore } from '../../store/semanticStore'

const MEMORY_COPY =
  '~20–40 MB per additional stream (embedding cache: up to 10,000 vectors × 384 × 4 bytes ≈ 15 MB + overhead).'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  streamLogin: string
  displayName: string
}

export function SemanticActivationDialog({ open, onOpenChange, streamLogin, displayName }: Props): JSX.Element {
  const handleEnable = () => {
    void useSemanticStore.getState().activate(streamLogin)
    onOpenChange(false)
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content data-testid="semantic-activation-dialog">
        <Dialog.Title>{`Enable semantic search for ${displayName}?`}</Dialog.Title>
        <Dialog.Description>Estimated memory delta: {MEMORY_COPY}</Dialog.Description>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Dialog.Close asChild>
            <button
              type="button"
              className="rounded-sm border border-border bg-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted transition hover:bg-surface-hover"
            >
              Cancel
            </button>
          </Dialog.Close>
          <button
            type="button"
            onClick={handleEnable}
            data-testid="semantic-activation-enable"
            className="rounded-sm border border-accent bg-accent/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-accent transition hover:bg-accent/20"
          >
            Enable
          </button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  )
}
