import { useState } from 'react'
import type { FilterState } from '../../types/twitch'
import { Button } from '../../components/ui/Button'
import { DropdownMenu } from '../../components/ui/DropdownMenu'
import { Toast } from '../../components/ui/Toast'
import {
  addPreset as addPresetStorage,
  deletePreset as deletePresetStorage,
  readPresets,
  type Preset,
} from './filterPresetsStorage'

interface FilterPresetsMenuProps {
  filterState: FilterState
  onFilterStateChange: (next: FilterState) => void
}

const encodeQuery = (query: string): string => btoa(encodeURIComponent(query))

export function FilterPresetsMenu({ filterState, onFilterStateChange }: FilterPresetsMenuProps): JSX.Element | null {
  const [presets, setPresets] = useState<Preset[]>(() => readPresets())
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const query = filterState.query ?? ''
  const hasQuery = query.trim().length > 0

  if (!hasQuery && presets.length === 0) return null

  const handleSave = (): void => {
    const name = window.prompt('Save query as preset — name:')
    if (!name) return
    const next = addPresetStorage(name, query)
    setPresets(next)
    setToastMessage(`Saved "${name}"`)
    setToastOpen(true)
  }

  const handleLoad = (preset: Preset): void => {
    onFilterStateChange({ ...filterState, query: preset.query, queryError: null })
  }

  const handleDelete = (name: string): void => {
    const next = deletePresetStorage(name)
    setPresets(next)
  }

  const handleShare = async (): Promise<void> => {
    const url = `${location.origin}${location.pathname}?filter=${encodeQuery(query)}`
    try {
      await navigator.clipboard.writeText(url)
      setToastMessage('Link copied')
      setToastOpen(true)
    } catch {
      setToastMessage('Copy failed')
      setToastOpen(true)
    }
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-mono uppercase tracking-[0.22em]"
            aria-label="Filter presets"
          >
            Presets
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start">
          {presets.length > 0 && (
            <>
              <DropdownMenu.Label>Saved presets</DropdownMenu.Label>
              {presets.map((preset) => (
                <div key={preset.name} className="flex items-center gap-1">
                  <DropdownMenu.Item
                    className="flex-1"
                    onSelect={(e) => {
                      e.preventDefault()
                      handleLoad(preset)
                    }}
                  >
                    {preset.name}
                  </DropdownMenu.Item>
                  <button
                    type="button"
                    aria-label={`Delete preset ${preset.name}`}
                    onClick={() => handleDelete(preset.name)}
                    className="px-2 text-text-muted hover:text-danger font-mono text-xs"
                  >
                    ×
                  </button>
                </div>
              ))}
              <DropdownMenu.Separator />
            </>
          )}
          {hasQuery && (
            <>
              <DropdownMenu.Item onSelect={handleSave}>Save current query as…</DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault()
                  void handleShare()
                }}
              >
                Share link
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Toast.Root open={toastOpen} onOpenChange={setToastOpen} duration={2500}>
        <Toast.Title>{toastMessage}</Toast.Title>
      </Toast.Root>
    </>
  )
}
