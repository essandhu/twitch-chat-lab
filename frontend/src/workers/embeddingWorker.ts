/// <reference lib="webworker" />
/**
 * Semantic embedding worker — hosts transformers.js off the main thread.
 *
 * Replay-purity boundary: this module must NOT read `Date.now()` or `Math.random()`.
 * Deterministic-in-time behavior starts at the `embed-batch` input; timestamps are
 * always caller-supplied so Phase 11 Recorder/Replay remains trace-equivalent.
 */
import type { EmbeddingRecord } from '../types/twitch'

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

/** SHA-256 of `onnx/model_quantized.onnx` on HuggingFace CDN — pinned from P10-01. */
const EXPECTED_MODEL_SHA = 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1'

type Extractor = (
  input: string | string[],
  options: { mean_pooling: boolean; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>

type InboundMessage =
  | { type: 'warm' }
  | { type: 'embed-batch'; items: Array<{ messageId: string; text: string }> }

type OutboundMessage =
  | { type: 'ready' }
  | { type: 'loading'; progress: number }
  | { type: 'batch-result'; results: EmbeddingRecord[] }
  | { type: 'fatal'; reason: string }

const post = (msg: OutboundMessage): void => {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)
}

const hexOfBuffer = (buf: ArrayBuffer): string => {
  const view = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0')
  return out
}

let extractorPromise: Promise<Extractor> | null = null

const loadExtractor = async (): Promise<Extractor> => {
  if (extractorPromise) return extractorPromise
  extractorPromise = (async () => {
    const mod = (await import('@xenova/transformers')) as {
      pipeline: (task: string, model: string, opts: { quantized: boolean; progress_callback?: (p: { status: string; progress?: number }) => void }) => Promise<Extractor>
      env?: { allowLocalModels?: boolean; useBrowserCache?: boolean }
    }
    if (mod.env) {
      mod.env.allowLocalModels = false
      mod.env.useBrowserCache = true
    }
    try {
      const url = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model_quantized.onnx`
      const res = await fetch(url)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', buf)
        const hex = hexOfBuffer(digest)
        if (hex !== EXPECTED_MODEL_SHA) {
          post({ type: 'fatal', reason: 'integrity-sha-mismatch' })
          throw new Error(`integrity-sha-mismatch: expected=${EXPECTED_MODEL_SHA} got=${hex}`)
        }
      }
    } catch (err) {
      // If the integrity fetch itself fails, surface a fatal so the UI reflects "off".
      const reason = err instanceof Error ? err.message : String(err)
      if (reason.startsWith('integrity-sha-mismatch')) throw err
      post({ type: 'fatal', reason: `integrity-fetch-failed:${reason}` })
      throw err
    }
    return mod.pipeline('feature-extraction', MODEL_ID, {
      quantized: true,
      progress_callback: (p) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          post({ type: 'loading', progress: Math.max(0, Math.min(1, p.progress / 100)) })
        }
      },
    })
  })()
  return extractorPromise
}

const warmUp = async (): Promise<void> => {
  await loadExtractor()
  post({ type: 'ready' })
}

const embedBatch = async (items: Array<{ messageId: string; text: string }>): Promise<void> => {
  if (items.length === 0) {
    post({ type: 'batch-result', results: [] })
    return
  }
  const extractor = await loadExtractor()
  const texts = items.map((it) => it.text)
  const output = await extractor(texts, { mean_pooling: true, normalize: true })
  const raw = output.data as Float32Array | number[]
  const dim = raw.length / items.length
  const results: EmbeddingRecord[] = items.map((it, i) => {
    const slice = new Float32Array(dim)
    for (let j = 0; j < dim; j++) slice[j] = raw[i * dim + j] as number
    return { messageId: it.messageId, vector: slice }
  })
  post({ type: 'batch-result', results })
}

self.addEventListener('message', (evt: MessageEvent<InboundMessage>) => {
  const msg = evt.data
  if (msg.type === 'warm') {
    warmUp().catch((err) => post({ type: 'fatal', reason: err instanceof Error ? err.message : String(err) }))
    return
  }
  if (msg.type === 'embed-batch') {
    embedBatch(msg.items).catch((err) =>
      post({ type: 'fatal', reason: err instanceof Error ? err.message : String(err) }),
    )
  }
})
