import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, WebSocketRoute } from '@playwright/test'
import gifenc from 'gifenc'

// gifenc ships a bundled CJS build whose named exports Node's ESM interop
// can't statically detect — destructure from the default export instead.
const { GIFEncoder, quantize, applyPalette } = gifenc
import { PNG } from 'pngjs'
import { test, expect, openDemo } from '../e2e/fixtures'
import { DEFAULT_HELIX, installHelixRoutes } from '../e2e/mocks/helix'
import { openFakeEventSub, type FakeEventSubHandle } from '../e2e/mocks/eventsub'
import { installProxyRoutes } from '../e2e/mocks/proxy'

/**
 * README media capture suite — generates the screenshots and demo GIF that
 * docs/media/ ships to recruiters. Every asset comes from the real running
 * app fed by the same offline mocks the E2E suite uses (mocked Helix +
 * EventSub in `?demo=playwright` mode) — nothing is fabricated outside the
 * product's own render path.
 *
 * Regenerate with `node docs/media/capture.mjs` (or, from frontend/,
 * `npm run capture:media`). See docs/media/README.md.
 *
 * Determinism notes (mirrors visual-regression.spec.ts):
 *  - reducedMotion kills the AppShell entry stagger.
 *  - `tcl.theme` is seeded before any page script runs.
 *  - `?semantic=0` keeps the 22 MB embedding model out of the run so the
 *    SemanticStatusChip never shifts the top nav mid-capture.
 *  - Chat content cycles deterministically through fixed line/chatter pools —
 *    no Math.random in the staging path.
 *
 * Staging constraints discovered against the real detectors:
 *  - detectQaClusters emits one moment per sliding 3-question/30 s window, so
 *    questions are scripted one-off beats (exactly three, ~3 s apart) rather
 *    than pool lines — one clean qa-cluster tick instead of dozens.
 *  - Heatmap annotation labels render at the ReferenceLine x-position; beats
 *    are spaced ≥ 15 s apart so labels don't overlap.
 *  - The heatmap ticks off wall-clock seconds (TICK_INTERVAL_MS = 1000), so
 *    the staged sessions really spend the seconds they depict.
 */

const MEDIA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/media')
mkdirSync(MEDIA_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Staged-cast content pools. Lengths are coprime (11 chatters, 24 lines) so
// cycling both by message index produces varied pairings without randomness.
// No line contains '?' — questions are scripted beats (see stageShow).
// ---------------------------------------------------------------------------

const CAST: Array<{ name: string; color: string }> = [
  { name: 'NoScopeNina', color: '#FF5C8A' },
  { name: 'pixel_druid', color: '#3FBF7F' },
  { name: 'KappaKingKarl', color: '#8A7CFF' },
  { name: 'stream_sniper42', color: '#FF9F45' },
  { name: 'lo_fi_lena', color: '#4EC9E1' },
  { name: 'GGEzra', color: '#E1524E' },
  { name: 'moth_to_vod', color: '#B8D94A' },
  { name: 'clutchCleo', color: '#FF6FD8' },
  { name: 'afk_andy', color: '#8FA3B8' },
  { name: 'TiltProofTina', color: '#57D9A3' },
  { name: 'vod_goblin', color: '#C792EA' },
]

const LINES: string[] = [
  'no shot he actually clutched that 1v3',
  'THE MOVEMENT IS UNREAL',
  'the sens is on point today',
  'gg that was clean',
  'chat is this real',
  'W rotate honestly',
  'three hours of grinding and it finally shows',
  'that pixel jump took me 3 hours yesterday',
  'POGGERS',
  'ok that spray control was criminal',
  'settings dump just hit the discord, go look',
  'the overlay heatmap goes crazy',
  'LETS GOOO',
  'ranked duos when',
  'insane read wow',
  'that flick was absurd',
  'literally built different',
  'KEKW he whiffed the ult',
  'nah this run is getting clipped',
  'crosshair code is in the panel below',
  'bro predicted the peek before it happened',
  'certified banger stream today',
  'top 1 gameplay no notes',
  'the aim is aiming today',
]

const RAID_LINES: string[] = [
  'RAID HYPE',
  'hello from the raid!!',
  'raiders have arrived',
  'welcome raiders 💜',
  'nightowl sent us, this gameplay is nuts',
  'POG raid',
]

// Scripted one-off beats.
const QUESTIONS: string[] = [
  'what sens are you playing on?',
  'what crosshair code is that?',
  'do you play ranked duos at all?',
]

const CALLOUTS: string[] = [
  '@Demouser that rotate call was perfect',
  '@Demouser run it back after this one',
]

// ---------------------------------------------------------------------------
// Staging helpers
// ---------------------------------------------------------------------------

const seedTheme = async (page: Page, theme: 'dark' | 'light'): Promise<void> => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript((t: string) => {
    try {
      localStorage.setItem('tcl.theme', t)
    } catch {
      // Playwright contexts always allow localStorage
    }
  }, theme)
}

/**
 * Pushes chat at ~`perSecond` messages per wall-clock second for `seconds`
 * seconds, drift-corrected against Date.now() so each heatmap tick counts a
 * steady rate. A deterministic ±1 wiggle (rates ≥ 3) keeps the curve looking
 * organic instead of ruler-flat.
 */
const flow = async (
  page: Page,
  sub: FakeEventSubHandle,
  seconds: number,
  perSecond: number,
  counter: { i: number },
  pool: string[] = LINES,
): Promise<void> => {
  const WIGGLE = [0, 1, -1, 0]
  for (let s = 0; s < seconds; s++) {
    const rate = Math.max(1, perSecond + (perSecond >= 3 ? WIGGLE[s % WIGGLE.length]! : 0))
    const secStart = Date.now()
    for (let m = 0; m < rate; m++) {
      const chatter = CAST[counter.i % CAST.length]!
      sub.pushChatMessage({
        username: chatter.name,
        color: chatter.color,
        text: pool[counter.i % pool.length]!,
      })
      counter.i += 1
      const wait = secStart + ((m + 1) * 1000) / rate - Date.now()
      if (wait > 4) await page.waitForTimeout(wait)
    }
    const rem = secStart + 1000 - Date.now()
    if (rem > 4) await page.waitForTimeout(rem)
  }
}

const pushQuestion = (sub: FakeEventSubHandle, idx: number): void => {
  const chatter = CAST[(idx * 3 + 1) % CAST.length]!
  sub.pushChatMessage({ username: chatter.name, color: chatter.color, text: QUESTIONS[idx]! })
}

/**
 * The shared eventsub mock omits `level` on hype-train begin, which renders
 * as "level undefined" in the heatmap annotation label. Push the frame
 * directly (same shape as mocks/eventsub.ts) with a concrete level instead.
 */
const pushHypeBegin = (sub: FakeEventSubHandle): void => {
  sub.ws.send(
    JSON.stringify({
      metadata: {
        message_id: 'msg_capture_hype_begin',
        message_type: 'notification',
        message_timestamp: new Date(Date.now() - 50).toISOString(),
        subscription_type: 'channel.hype_train.begin',
        subscription_version: '2',
      },
      payload: {
        subscription: {
          id: 'sub_channel.hype_train.begin',
          type: 'channel.hype_train.begin',
          version: '2',
          status: 'enabled',
          cost: 0,
          condition: {},
          transport: { method: 'websocket', session_id: 'fake-session-id' },
          created_at: new Date().toISOString(),
        },
        event: {
          id: 'hype_capture_1',
          broadcaster_user_id: '99999999',
          broadcaster_user_login: 'demouser',
          broadcaster_user_name: 'Demouser',
          level: 1,
          total: 120,
          progress: 40,
          goal: 500,
          started_at: new Date().toISOString(),
        },
      },
    }),
  )
}

/**
 * ~66 s staged session. Beats are spaced so heatmap annotation labels never
 * overlap: subscription @~10 s, hype train @~29 s, raid @~46 s. Ends with two
 * fresh chatters so the first-time-chatter highlight shows in the final frame.
 */
const stageShow = async (page: Page, sub: FakeEventSubHandle): Promise<void> => {
  const c = { i: 0 }

  // Warmup — 18 s at 2 msg/s with a cheer and a subscription marker.
  await flow(page, sub, 6, 2, c)
  sub.pushCheer({
    username: 'GGEzra',
    text: 'take my bits, that clutch deserved it Cheer200',
    bits: 200,
  })
  await flow(page, sub, 4, 2, c)
  sub.pushSubscription({ user: 'lo_fi_lena' })
  await flow(page, sub, 8, 2, c)

  // Pin lands at ~18 s and stays up for the rest of the session.
  sub.pushPin({
    messageId: 'pin-showcase',
    text: 'Drop your questions below — Q&A after this run 💜',
    userName: 'Demouser',
    userLogin: 'demouser',
  })

  // Scripted Q&A beat — exactly three questions inside one 30 s window
  // produces exactly one qa-cluster tick on the Moments strip. The hype train
  // starts mid-beat (~25 s) so its chart label clears the raid label at ~48 s.
  await flow(page, sub, 1, 3, c)
  pushQuestion(sub, 0)
  await flow(page, sub, 3, 3, c)
  pushQuestion(sub, 1)
  await flow(page, sub, 3, 3, c)
  pushHypeBegin(sub)
  await flow(page, sub, 1, 3, c)
  pushQuestion(sub, 2)
  await flow(page, sub, 3, 4, c)

  // Ramp — two @broadcaster callouts feed the Intelligence Callouts tab.
  await flow(page, sub, 3, 5, c)
  sub.pushChatMessage({ username: 'TiltProofTina', color: '#57D9A3', text: CALLOUTS[0]! })
  await flow(page, sub, 3, 5, c)
  sub.pushChatMessage({ username: 'vod_goblin', color: '#C792EA', text: CALLOUTS[1]! })
  await flow(page, sub, 9, 5, c)

  // Raid at ~48 s — annotation + a spike run well above the rolling average.
  sub.pushRaid({ fromBroadcaster: 'nightowl_plays', viewers: 1840 })
  await flow(page, sub, 4, 8, c, RAID_LINES)
  sub.pushCheer({ username: 'clutchCleo', text: 'Cheer500 raid hype, take my bits', bits: 500 })
  await flow(page, sub, 6, 8, c)

  // Cooldown — two never-seen chatters so the first-timer highlight shows.
  await flow(page, sub, 5, 3, c)
  sub.pushChatMessage({
    username: 'first_time_felix',
    color: '#FFD166',
    text: 'first time here, this is awesome',
  })
  await page.waitForTimeout(400)
  sub.pushChatMessage({
    username: 'lurker_no_more',
    color: '#06D6A0',
    text: 'ok the raid brought me but the chat filters are keeping me',
  })
  await page.waitForTimeout(1_200)
}

// ---------------------------------------------------------------------------
// GIF assembly — Playwright's bundled ffmpeg has no GIF encoder, so frames
// come from a CDP screencast (Chromium scales them to 960 px) and encoding
// happens in-process with gifenc + pngjs. Fully reproducible via npm.
// ---------------------------------------------------------------------------

interface ScreencastFrame {
  ts: number
  buf: Buffer
}

const encodeGif = (frames: ScreencastFrame[], outPath: string): number => {
  if (frames.length < 8) throw new Error(`only ${frames.length} screencast frames captured`)
  const FPS = 8
  const first = PNG.sync.read(frames[0]!.buf)
  const { width, height } = first

  // Global palette from a mid-scene frame — colors are stable in the dark UI
  // and a shared palette keeps the file well under GitHub's 10 MB threshold.
  const mid = PNG.sync.read(frames[Math.floor(frames.length / 2)]!.buf)
  const palette = quantize(mid.data, 256)

  const gif = GIFEncoder()
  const startTs = frames[0]!.ts
  const endTs = frames[frames.length - 1]!.ts
  let cursor = 0
  for (let t = startTs; t <= endTs; t += 1 / FPS) {
    while (cursor + 1 < frames.length && frames[cursor + 1]!.ts <= t) cursor += 1
    const png = PNG.sync.read(frames[cursor]!.buf)
    if (png.width !== width || png.height !== height) continue
    const indexed = applyPalette(png.data, palette)
    gif.writeFrame(indexed, width, height, { palette, delay: Math.round(1000 / FPS), repeat: 0 })
  }
  gif.finish()
  writeFileSync(outPath, Buffer.from(gif.bytes()))

  const size = statSync(outPath).size
  if (size > 9_500_000) {
    throw new Error(`demo.gif is ${size} bytes — over the 9.5 MB budget; shorten the scene or drop FPS`)
  }
  return size
}

// ---------------------------------------------------------------------------
// Stills — 1440×900 @2x, matching the repo's desktop visual-regression size.
// ---------------------------------------------------------------------------

test.describe('README stills', () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

  test('hero (dark) + intelligence + perf overlay', async ({ page, eventSub }) => {
    await seedTheme(page, 'dark')
    await page.goto('/?demo=playwright&semantic=0')
    const sub = await eventSub
    await expect(page.getByRole('button', { name: /compare streams/i })).toBeEnabled({
      timeout: 15_000,
    })
    await page.waitForTimeout(900) // AppShell first-mount stagger (800 ms timer)

    await stageShow(page, sub)
    await page.screenshot({ path: join(MEDIA_DIR, 'hero.png') })

    // Intelligence panel rides the same session — its Questions / Callouts /
    // Bits tabs were fed by the scripted beats above. Chat keeps flowing so
    // the NOW stat and heatmap tail don't read as a dead stream.
    await page.getByRole('tab', { name: /intelligence/i }).click()
    const ic = { i: 200 }
    await flow(page, sub, 3, 4, ic)
    await page.screenshot({ path: join(MEDIA_DIR, 'intelligence.png') })
    await page.getByRole('tab', { name: /^chat$/i }).click()
    await page.waitForTimeout(300)

    // Perf overlay shot needs live flow so the metrics are non-trivial.
    await page.keyboard.press('Control+Shift+P')
    const c = { i: 400 } // offset so overlay-shot lines differ from hero tail
    await flow(page, sub, 4, 5, c)
    await page.screenshot({ path: join(MEDIA_DIR, 'perf-overlay.png') })
  })

  test('hero (light)', async ({ page, eventSub }) => {
    await seedTheme(page, 'light')
    await page.goto('/?demo=playwright&semantic=0')
    const sub = await eventSub
    await expect(page.getByRole('button', { name: /compare streams/i })).toBeEnabled({
      timeout: 15_000,
    })
    await page.waitForTimeout(900)

    await stageShow(page, sub)
    await page.screenshot({ path: join(MEDIA_DIR, 'hero-light.png') })
  })

  test('multi-stream comparison', async ({ page, eventSub }) => {
    await seedTheme(page, 'dark')
    const proxy = await installProxyRoutes(page)
    await openDemo(page, eventSub)
    await expect(page.getByRole('button', { name: /compare streams/i })).toBeEnabled({
      timeout: 15_000,
    })
    await page.waitForTimeout(900)

    await page.getByRole('button', { name: /compare streams/i }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
    const selectBoxes = page.getByRole('checkbox', { name: /select /i })
    await expect(selectBoxes).toHaveCount(5, { timeout: 10_000 })
    await selectBoxes.nth(0).click()
    await selectBoxes.nth(1).click()
    await page.getByRole('button', { name: /^compare$/i }).click()

    const handle = await proxy.wsOpened
    await expect(page.getByRole('button', { name: /exit multi-stream mode/i })).toBeVisible()

    const columns: Array<{ login: string; users: string[]; lines: string[] }> = [
      {
        login: 'demouser',
        users: ['NoScopeNina', 'GGEzra', 'clutchCleo', 'vod_goblin'],
        lines: LINES,
      },
      {
        login: 'alt_one',
        users: ['frame_perfect_fi', 'splits_or_quits', 'sub_9_enjoyer', 'reset_ranata'],
        lines: [
          'PB pace holy',
          'the skip at 12:40 was frame perfect',
          'gold split GOLD SPLIT',
          'this category is cursed and I love it',
          'timer check for chat',
          'no reset no reset no reset',
        ],
      },
      {
        login: 'alt_two',
        users: ['cozy_corvid', 'tea_and_totems', 'pixel_potter', 'slow_sunday'],
        lines: [
          'this base tour is so cozy',
          'the greenhouse build is gorgeous',
          'that texture pack is so clean',
          'lofi + block placing = perfect sunday',
          'petition to name the cat Biscuit',
          'the attention to detail omg',
        ],
      },
    ]

    // ~14 rounds × 3 streams with real gaps so per-column heatmap lines and
    // the cross-stream Spotlight feed both accumulate.
    for (let round = 0; round < 14; round++) {
      for (const col of columns) {
        handle.pushChat(
          col.login,
          col.lines[round % col.lines.length]!,
          col.users[round % col.users.length]!,
        )
      }
      await page.waitForTimeout(320)
    }
    await page.waitForTimeout(2_500)
    await page.screenshot({ path: join(MEDIA_DIR, 'multi-stream.png') })
  })
})

// ---------------------------------------------------------------------------
// Demo GIF — real-time CDP screencast of a raid landing mid-session.
// ---------------------------------------------------------------------------

test.describe('README demo GIF', () => {
  test('live chat + raid burst', async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL: 'http://localhost:5173',
      viewport: { width: 1280, height: 800 },
    })
    const page = await ctx.newPage()
    await seedTheme(page, 'dark')

    // Same offline route mocks the shared fixture wires up, on a manual context.
    await page.route('**/api.twitch.tv/helix/**', (route) => installHelixRoutes(route, DEFAULT_HELIX))
    await page.route('**/id.twitch.tv/oauth2/validate', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    let resolveWs: (h: FakeEventSubHandle) => void
    const handleP = new Promise<FakeEventSubHandle>((r) => {
      resolveWs = r
    })
    await page.routeWebSocket('wss://eventsub.wss.twitch.tv/**', (ws: WebSocketRoute) =>
      resolveWs(openFakeEventSub(ws)),
    )

    await page.goto('/?demo=playwright&semantic=0')
    const sub = await handleP
    await expect(page.getByRole('button', { name: /compare streams/i })).toBeEnabled({
      timeout: 15_000,
    })
    await page.waitForTimeout(900)

    // Build ~14 s of heatmap history before recording starts.
    const c = { i: 0 }
    await flow(page, sub, 14, 3, c)

    // Record ~12 s: one settle second, then the raid lands and chat surges.
    const cdp = await ctx.newCDPSession(page)
    const frames: ScreencastFrame[] = []
    cdp.on('Page.screencastFrame', (evt) => {
      frames.push({
        ts: evt.metadata.timestamp ?? Date.now() / 1000,
        buf: Buffer.from(evt.data, 'base64'),
      })
      void cdp.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', {
      format: 'png',
      maxWidth: 960,
      maxHeight: 600,
      everyNthFrame: 1,
    })

    await flow(page, sub, 1, 3, c)
    sub.pushRaid({ fromBroadcaster: 'nightowl_plays', viewers: 1840 })
    await flow(page, sub, 3, 6, c, RAID_LINES)
    await flow(page, sub, 8, 6, c)

    await cdp.send('Page.stopScreencast')
    await ctx.close()

    const size = encodeGif(frames, join(MEDIA_DIR, 'demo.gif'))
    console.log(`demo.gif: ${frames.length} raw frames → ${(size / 1024 / 1024).toFixed(1)} MB`)
  })
})
