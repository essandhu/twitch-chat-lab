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

Phase 11 canonical schema:

```json
{
  "t": "<ISO-8601>",
  "kind": "notification" | "session_welcome" | "session_keepalive" | "session_reconnect" | "revocation",
  "streamLogin": "<login>",
  "payload": { /* full EventSubFrame: { metadata, payload } */ }
}
```

Frames are sorted by `t` (ISO-8601 string, parsed to epoch-ms at load time) ascending. The header (line 1) is identified by the absence of the `t` field.

Replayers walk frames in order; `payload` is the full EventSubFrame (`metadata` + nested `payload`) — the same shape produced by `SessionRecorder` in live mode. `SessionReplayer.load` parses, sorts, and dispatches each frame through `EventSubManager.dispatchFrame` at the recorded cadence.

**Legacy fixtures** (Phase 8/9/10 pre-Phase-11) use `t: <ms-offset>` (number) and a flattened `payload: { subscription_type, event }` shape. These are migrated to the canonical schema in P11-14.

## Generators

`phase-8-recording.jsonl` is synthetic — frames are generated rather than recorded. The source-of-truth generator is intentionally kept in version control so Phase 9/10 can generate their own fixtures with the same shape; Phase 11 swaps in the live Recorder.

`phase-10-recording.jsonl` is also synthetic (seeded from `sha256('phase-10-seed')`). Single-stream 90-second session. Triggered moments:

- `t = 0–60 s` — baseline chat at 1 msg/s (sets `heatmap.rollingAverage30s` ≈ 1).
- `t = 60–75 s` — 30 messages from a `boss fight` vocabulary cluster (drives `detectMoments.semantic-cluster`).
- `t = 75–85 s` — 60-message noise burst at 6 msg/s (well above 2× baseline, drives `detectMoments.spike`).
- `t = 85–90 s` — decay back to baseline.

Regenerate with `node tests/fixtures/generate-phase-10-recording.mjs`.

`phase-6-recording.jsonl` (Phase 11, P11-12; seeded from `sha256('phase-6-seed')`) — single-stream 45 s session exercising every Phase 6 chat-fidelity surface: plain chat, reply (with `reply.*` fields), cheer (bits + cheermote fragment), subscribe, resub, community sub-gift, raid, announcement, pin + unpin, message-delete, per-user clear, chat clear. 19 frames, ~18 KB. Conforms to the Phase 11 canonical schema (ISO `t`, full-EventSubFrame `payload`).

Regenerate with `node tests/fixtures/generate-phase-6-recording.mjs`.

`multi-stream-recording.jsonl` (Phase 11, P11-13; seeded from `sha256('multi-stream-seed')`) — 3-stream 30 s session (streamer_a, streamer_b, streamer_c) with balanced chat volume across all streams and a `channel.raid` notification on streamer_b at `t = 15 s`. 91 frames, ~88 KB. The raid pivot is the synchronization test point referenced by `architecture.md:1410` (scrub to 15 s → raid annotation appears on stream B only).

Regenerate with `node tests/fixtures/generate-multi-stream-recording.mjs`.
