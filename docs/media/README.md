# README media

Every asset in this directory is captured from the **real running app** by
`frontend/tests/media/capture.spec.ts` — a Playwright suite that boots the
Vite dev server and drives the same offline mock infrastructure the E2E suite
uses (`?demo=playwright` with mocked Helix/EventSub). No screenshot is
composited or mocked outside the product's own render path.

## Regenerate

```bash
node docs/media/capture.mjs
# or, from frontend/:
npm run capture:media
```

Requirements: `npm install` in `frontend/` and Playwright's Chromium
(`npx playwright install chromium`). The GIF is encoded in-process with
`gifenc` from CDP screencast frames — no ffmpeg needed.

The full run takes ~4 minutes: the heatmap accrues one data point per
wall-clock second, so the staged sessions really do spend the seconds they
depict.

## Assets

| File | What it shows | How it's staged |
|---|---|---|
| `hero.png` / `hero-light.png` | Main view: virtualized chat, engagement heatmap with raid/sub/hype-train markers, Moments strip, pinned message, first-time-chatter highlights | ~66 s scripted session over mocked EventSub (calm → cheer/sub → pin → Q&A beat → hype train → raid spike → cooldown) |
| `demo.gif` | Live chat flowing while a raid lands and the heatmap advances in real time | ~12 s CDP screencast of the same staged session, encoded with gifenc |
| `multi-stream.png` | 2 + 1 side-by-side chat columns with the cross-stream Spotlight dock | Mocked Go-proxy WebSocket fanning distinct scripted chat into 3 streams |
| `intelligence.png` | Intelligence panel fed by the staged session (questions, callouts, bits) | Same session as `hero.png`, dock switched to the Intelligence tab |
| `perf-overlay.png` | `Ctrl+Shift+P` instrumentation overlay with live metrics | Same session as `hero.png`, captured mid-flow |

Staging is deterministic: chat content cycles through fixed chatter/line
pools, questions/callouts are scripted one-off beats (calibrated against the
real `detectMoments` thresholds so the Moments strip shows a handful of
well-spaced ticks), and semantic features run with `?semantic=0` so captures
never depend on the 22 MB embedding-model download.

There is intentionally no replay-mode screenshot: replay never starts the
heatmap ticker (`EventSubManager.startHeatmapTick` only runs on live
connect), so any full-frame replay capture shows an empty "Waiting for chat"
pane. If that ever changes, add a scene that replays
`tests/fixtures/phase-10-recording.jsonl` and seeks to ~88 s.
