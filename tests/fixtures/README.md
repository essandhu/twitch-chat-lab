# Recording fixtures

This directory holds hand-crafted / recorded chat-session fixtures for E2E + integration tests.
Phase 8 ships the first recording — subsequent phases and the Phase 11 Recorder MUST mirror this schema.

## Schema (JSONL, one record per line)

**Line 1 — header:**

```json
{
  "schemaVersion": 1,
  "recordedAt": "<ISO-8601>",
  "recorderVersion": "<identifier>"
}
```

**Lines 2..N — frames:**

```json
{
  "t": <ms-from-window-start>,
  "kind": "notification",
  "streamLogin": "<login>",
  "payload": {
    "subscription_type": "channel.chat.message" | "channel.chat.notification",
    "event": { ... Twitch EventSub event object ... }
  }
}
```

Frames are sorted by `t` ascending. The header (line 1) is identified by the absence of the `t` field.

Replayers walk frames in order; dispatch `payload.event` keyed on `streamLogin` at the indicated offset. `kind` is reserved for future variants (e.g., annotation-only frames, error injections) — keep a default path for `"notification"` and fall through for unknown kinds.

## Generators

`phase-8-recording.jsonl` is synthetic — frames are generated rather than recorded. The source-of-truth generator is intentionally kept in version control so Phase 9/10 can generate their own fixtures with the same shape; Phase 11 swaps in the live Recorder.

`phase-10-recording.jsonl` is also synthetic (seeded from `sha256('phase-10-seed')`). Single-stream 90-second session. Triggered moments:

- `t = 0–60 s` — baseline chat at 1 msg/s (sets `heatmap.rollingAverage30s` ≈ 1).
- `t = 60–75 s` — 30 messages from a `boss fight` vocabulary cluster (drives `detectMoments.semantic-cluster`).
- `t = 75–85 s` — 60-message noise burst at 6 msg/s (well above 2× baseline, drives `detectMoments.spike`).
- `t = 85–90 s` — decay back to baseline.

Regenerate with `node tests/fixtures/generate-phase-10-recording.mjs`.
