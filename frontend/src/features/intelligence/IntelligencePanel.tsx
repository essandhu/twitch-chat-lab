import { useEffect, useMemo, useState } from 'react'
import { Tabs } from '../../components/ui/Tabs'
import { Select } from '../../components/ui/Select'
import { useChatStore } from '../../store/chatStore'
import { useMultiStreamStore } from '../../store/multiStreamStore'
import { PRIMARY_STREAM_KEY, useIntelligenceStore } from '../../store/intelligenceStore'
import type { AccountAgeRecord, ChatMessage, ExtractedSignalKind, ExtractedSignalRef } from '../../types/twitch'
import { ExtractedSignalList } from './ExtractedSignalList'
import { SemanticSearch } from '../semantic/SemanticSearch'

type PanelTab = ExtractedSignalKind | 'semantic'

type Mode = 'single' | 'multi'

interface IntelligencePanelProps {
  mode?: Mode
}

const TAB_STORAGE_KEY = 'tcl.intelligence.tab'
const DEFAULT_TAB: PanelTab = 'question'
const ALL_STREAMS = '__all__'
const MERGE_CAP = 200

const TABS: Array<{ value: PanelTab; label: string }> = [
  { value: 'question', label: 'Questions' },
  { value: 'callout', label: 'Callouts' },
  { value: 'bitsContext', label: 'Bits' },
  { value: 'semantic', label: 'Semantic' },
]

type SignalKey = 'question' | 'callout' | 'bitsContext'

const SIGNAL_FIELD: Record<SignalKey, 'questions' | 'callouts' | 'bitsContext'> = {
  question: 'questions',
  callout: 'callouts',
  bitsContext: 'bitsContext',
}

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
  const slices = useIntelligenceStore((s) => s.slices)

  const isAll = mode === 'multi' && activeStream === ALL_STREAMS
  const intelKey = mode === 'multi' ? activeStream : PRIMARY_STREAM_KEY
  const slice = isAll ? undefined : slices[intelKey]

  useEffect(() => {
    storeTab(tab)
  }, [tab])

  useEffect(() => {
    if (mode !== 'multi') return
    if (order.length === 0) return
    if (activeStream === ALL_STREAMS) return
    if (!order.includes(activeStream)) {
      setActiveStream(order[0])
    }
  }, [mode, order, activeStream])

  const resolve = useMemo(() => {
    if (mode === 'single') return (id: string) => chatMessagesById[id]
    const byId = new Map<string, ChatMessage>()
    if (isAll) {
      for (const login of order) {
        const list = streams[login]?.messages ?? []
        for (const m of list) byId.set(m.id, m)
      }
    } else {
      for (const m of streams[activeStream]?.messages ?? []) byId.set(m.id, m)
    }
    return (id: string) => byId.get(id)
  }, [mode, isAll, activeStream, chatMessagesById, streams, order])

  const allSignals = useMemo(() => {
    if (!isAll) return null
    const displayNameByLogin: Record<string, string> = {}
    for (const login of order) {
      displayNameByLogin[login] = streams[login]?.displayName ?? login
    }
    const buildKind = (kind: SignalKey) => {
      const merged: Array<{ ref: ExtractedSignalRef; login: string }> = []
      for (const login of order) {
        const s = slices[login]
        if (!s) continue
        for (const ref of s.extractedSignals[SIGNAL_FIELD[kind]]) {
          merged.push({ ref, login })
        }
      }
      merged.sort((a, b) => a.ref.timestamp - b.ref.timestamp)
      const capped = merged.length > MERGE_CAP ? merged.slice(merged.length - MERGE_CAP) : merged
      const badges: Record<string, string> = {}
      for (const x of capped) badges[x.ref.messageId] = displayNameByLogin[x.login] ?? x.login
      return { refs: capped.map((x) => x.ref), badges }
    }
    const accountAgeByUserId: Record<string, AccountAgeRecord> = {}
    for (const login of order) {
      const s = slices[login]
      if (!s) continue
      for (const [userId, record] of Object.entries(s.accountAge)) {
        if (!accountAgeByUserId[userId]) accountAgeByUserId[userId] = record
      }
    }
    return {
      question: buildKind('question'),
      callout: buildKind('callout'),
      bitsContext: buildKind('bitsContext'),
      accountAgeByUserId,
    }
  }, [isAll, order, streams, slices])

  const refsByKind = slice?.extractedSignals ?? { questions: [], callouts: [], bitsContext: [] }
  const canScroll = mode === 'single'
  const showStreamSelector = mode === 'multi' && order.length > 0 && tab !== 'semantic'

  const refsFor = (kind: SignalKey): ExtractedSignalRef[] =>
    isAll && allSignals ? allSignals[kind].refs : refsByKind[SIGNAL_FIELD[kind]]

  const badgesFor = (kind: SignalKey): Record<string, string> | undefined =>
    isAll && allSignals ? allSignals[kind].badges : undefined

  return (
    <div className="flex h-full flex-col" data-testid="intelligence-panel">
      {showStreamSelector && (
        <div className="border-b border-border px-3 py-2">
          <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
            <span>Stream</span>
            <Select
              value={activeStream}
              onChange={(e) => setActiveStream(e.target.value)}
              aria-label="Stream selector for intelligence panel"
            >
              <option value={ALL_STREAMS}>All streams</option>
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
              refs={refsFor(kind)}
              resolve={resolve}
              canScroll={canScroll}
              streamLogin={mode === 'multi' && !isAll ? activeStream : undefined}
              streamBadgeByMessageId={badgesFor(kind)}
              accountAgeByUserId={isAll ? allSignals?.accountAgeByUserId : undefined}
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
