import { useEffect, useMemo, useState } from 'react'
import { Tabs } from '../../components/ui/Tabs'
import { Select } from '../../components/ui/Select'
import { useChatStore } from '../../store/chatStore'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from '../../store/intelligenceStore'
import type { ChatMessage, ExtractedSignalKind } from '../../types/twitch'
import { ExtractedSignalList } from './ExtractedSignalList'
import { SemanticSearch } from '../semantic/SemanticSearch'

type PanelTab = ExtractedSignalKind | 'semantic'

type Mode = 'single' | 'multi'

interface IntelligencePanelProps {
  mode?: Mode
}

const TAB_STORAGE_KEY = 'tcl.intelligence.tab'
const DEFAULT_TAB: PanelTab = 'question'

const TABS: Array<{ value: PanelTab; label: string }> = [
  { value: 'question', label: 'Questions' },
  { value: 'callout', label: 'Callouts' },
  { value: 'bitsContext', label: 'Bits' },
  { value: 'semantic', label: 'Semantic' },
]

const isPanelTab = (v: string): v is PanelTab =>
  v === 'question' || v === 'callout' || v === 'bitsContext' || v === 'semantic'

const readTab = (): PanelTab => {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_TAB
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    if (v && isPanelTab(v)) return v
  } catch {
    // fall through
  }
  return DEFAULT_TAB
}

const storeTab = (tab: PanelTab): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TAB_STORAGE_KEY, tab)
  } catch {
    // ignore storage errors
  }
}

export function IntelligencePanel({ mode = 'single' }: IntelligencePanelProps): JSX.Element {
  const [tab, setTab] = useState<PanelTab>(() => readTab())
  const order = useMultiStreamStore((s) => s.order)
  const streams = useMultiStreamStore((s) => s.streams)
  const [activeStream, setActiveStream] = useState<string>(() => order[0] ?? '')
  const chatMessagesById = useChatStore((s) => s.messagesById)
  const intelKey = mode === 'multi' ? activeStream : PRIMARY_STREAM_KEY
  const slice = useIntelligenceStore((s) => s.slices[intelKey])

  useEffect(() => {
    storeTab(tab)
  }, [tab])

  useEffect(() => {
    if (mode === 'multi' && order.length > 0 && !order.includes(activeStream)) {
      setActiveStream(order[0])
    }
  }, [mode, order, activeStream])

  const resolve = useMemo(() => {
    if (mode === 'single') return (id: string) => chatMessagesById[id]
    const multiMessages = streams[activeStream]?.messages ?? []
    const byId = new Map<string, ChatMessage>()
    for (const m of multiMessages) byId.set(m.id, m)
    return (id: string) => byId.get(id)
  }, [mode, activeStream, chatMessagesById, streams])

  const refsByKind = slice?.extractedSignals ?? { questions: [], callouts: [], bitsContext: [] }
  const canScroll = mode === 'single'

  return (
    <div className="flex h-full flex-col" data-testid="intelligence-panel">
      {mode === 'multi' && order.length > 0 && (
        <div className="border-b border-border px-3 py-2">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
            <span>Stream</span>
            <Select
              value={activeStream}
              onChange={(e) => setActiveStream(e.target.value)}
              aria-label="Stream selector for intelligence panel"
            >
              {order.map((login) => (
                <option key={login} value={login}>
                  {streams[login]?.displayName ?? login}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}
      <Tabs.Root value={tab} onValueChange={(v) => isPanelTab(v) && setTab(v)} className="flex h-full flex-col min-h-0">
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Trigger key={t.value} value={t.value}>
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {(['question', 'callout', 'bitsContext'] as const).map((kind) => (
          <Tabs.Content key={kind} value={kind} className="flex-1 min-h-0 overflow-auto pt-0">
            <ExtractedSignalList
              kind={kind}
              refs={kind === 'question' ? refsByKind.questions : kind === 'callout' ? refsByKind.callouts : refsByKind.bitsContext}
              resolve={resolve}
              canScroll={canScroll}
              streamLogin={mode === 'multi' ? activeStream : undefined}
            />
          </Tabs.Content>
        ))}
        <Tabs.Content value="semantic" className="flex-1 min-h-0 pt-0">
          <SemanticSearch />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}
