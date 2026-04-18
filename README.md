# Twitch Chat Lab

A high-throughput Twitch chat interface with engagement instrumentation, smart filters, and a multi-stream comparison view.

## Live demo

**https://&lt;vercel-app&gt;.vercel.app/?demo=1**

No login required — read-only demo against a popular live channel. _(Replace the placeholder above with the deployed Vercel URL once Phase 5 deploys complete.)_

## Features

- **Real-time virtualized chat** — `@tanstack/react-virtual` sustains > 1k msg/s with bounded DOM (verified by a 10,000-message integration test under happy-dom; per-frame render stays under 16 ms).
- **Live engagement heatmap** — rolling 5-minute msg/s line chart with annotated event markers for raids, subscriptions, and hype trains.
- **Four composable smart filters** — first-timers, subscribers-only, keyword, and hype-mode (velocity spikes relative to rolling 30 s average). Filters compose with **AND** logic via a pure `applyFilters` function.
- **First-time chatter spotlight** — per-session detection (first-message-in-session, not "first ever in channel" — EventSub does not expose that, and the UI tooltip says so).
- **Multi-stream chat comparison** — 2 or 3 streams in the same Twitch category, side-by-side, fanned in by a Go WebSocket proxy. One client WebSocket; the proxy maintains one EventSub connection per stream.
- **Performance instrumentation overlay** — `Ctrl+Shift+P` reveals render msg/s, virtualizer time, DOM node count, JS heap (Chromium-only), and EventSub end-to-end latency.

## What the perf panel shows

| Metric | What it measures | Healthy range |
|---|---|---|
| **Render** | ChatMessage components rendered per second (counter, 1 s window) | Matches incoming msg/s; saturates around 1–2 k on a busy channel |
| **Virtualizer** | `performance.measure` around the virtual-items render | < 16 ms; amber above |
| **DOM nodes** | `document.querySelectorAll('*').length`, polled every 500 ms | Bounded — should not grow with message count |
| **Heap** | `performance.memory.usedJSHeapSize / 1 MB` (Chromium only; `n/a` elsewhere) | < 200 MB; amber above |
| **EventSub latency** | `Date.now() - metadata.message_timestamp`, exponentially smoothed | < 500 ms; amber above. Measures browser→Twitch round-trip. |

## Local dev

```bash
# Frontend
cd frontend
cp .env.example .env    # fill in VITE_TWITCH_CLIENT_ID; others have sane defaults
npm install
npm run dev              # port 5173

# Proxy (in another terminal)
cd proxy
cp .env.example .env    # fill in TWITCH_CLIENT_ID, ALLOWED_ORIGINS
go run ./cmd/server     # port 8080
```

Open `http://localhost:5173`. Enter a Twitch channel login, complete OAuth, and chat streams in.

For **local demo mode** (skip OAuth), set `VITE_DEMO_USER_ID` and `VITE_DEMO_TOKEN` in `frontend/.env` and open `http://localhost:5173/?demo=1`. The channel is picked at runtime from Twitch's live "Just Chatting" streams, so the demo never lands on an offline broadcaster.

### Test suites

```bash
# Frontend unit + integration (Vitest)
cd frontend && npm test

# Frontend E2E (Playwright, runs dev server + proxy as needed)
cd frontend && npm run test:e2e

# Proxy (Go)
cd proxy && go test -race ./...
```

CI runs all three on every push to `main` (see `.github/workflows/ci.yml`).

## Twitch app registration

1. Visit `https://dev.twitch.tv/console/apps` and click **Register Your Application**.
2. Name: anything. Category: **Application Integration**.
3. **OAuth Redirect URLs** — add both:
   - `http://localhost:5173/auth/callback` (local dev)
   - `https://<vercel-app>.vercel.app/auth/callback` (production)
4. Copy the **Client ID** into `frontend/.env` and `proxy/.env` as `VITE_TWITCH_CLIENT_ID` / `TWITCH_CLIENT_ID`.
5. **No client secret needed** — this is an Implicit Grant SPA (see Tech decisions below).

## Tech decisions

### `@tanstack/react-virtual` over `react-window`

Better TypeScript support, smaller public API, and built-in dynamic measurement for variable-height rows. Result: every chat row can render rich content (emotes, badges, multi-line messages) without pinning `estimateSize` to the tallest case.

### Zustand over Redux

The only state-consumer pattern in this app is "subscribe to a slice." Zustand does that natively (`useChatStore((s) => s.messages)`) without selectors + `React.memo` wrappers + `useSelector` + action creators + reducers. Less ceremony, same correctness, hooks-native.

### Go proxy over a Node proxy

Three reasons:

1. **Demonstrates Go concurrency** — goroutines per upstream, `chan []byte` fan-in, `context.Context` propagation for cascade teardown, exponential backoff on reconnect.
2. **Single-binary deploy** on Fly.io. ~15 MB distroless image, no Node runtime to configure.
3. **Fan-in ergonomics.** No Node WebSocket library matches `select { case <-ctx.Done(): … case frame := <-upstream: … }` for multi-source aggregation.

### Implicit Grant over PKCE

Twitch does **not** support PKCE for Authorization Code Grant (confirmed via Twitch OAuth docs as of 2026). For a browser-only SPA with no server secret, Implicit Grant is the supported path. Tokens live in memory only — page reload re-authenticates. A 5-minute `/oauth2/validate` poll catches revocation (except in demo mode — see Known limitations).

## Known limitations

- **Demo token rotation.** Implicit Grant has no refresh token. When the cached demo token expires, the live demo breaks until the operator manually generates a new one and redeploys.
- **First-timer detection is per-session.** EventSub's `channel.chat.message` does not expose `is_first_message` (the old IRC `first-msg` tag was not carried over). We label the UI accordingly — "first this session," not "first ever in channel."
- **`jsHeapUsedMB` is Chromium-only.** `performance.memory` is a non-standard API. Firefox and Safari show `n/a` with a tooltip.
- **Non-own-channel viewing degrades to chat-rate-only.** Twitch returns 403 for `channel.subscribe` / `channel.hype_train.*` subscriptions on channels the authed user does not own. The chat feed and heatmap velocity still work; event markers (raids, subs, hype) only appear for your own channel. The UI calls this out.
