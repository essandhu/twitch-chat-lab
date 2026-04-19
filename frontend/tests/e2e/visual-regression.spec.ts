import { test, expect, openDemo } from './fixtures'

/**
 * Phase 7 · P7-24 · visual-regression baseline suite.
 *
 * Captures the AppShell + each `data-shell-section` wrapper at 3 viewports
 * × 2 themes. Mobile intentionally skips `left-rail` and `chat-dock` — in
 * MobileShell those slots are not present in the grid (they live inside a
 * Dialog triggered by the hamburger / chat FAB), so they have no stable
 * on-screen element to snapshot without driving the sheet. That gives
 * 1 shell + 4 sections × 2 themes × 2 desktop/tablet viewports = 20,
 * plus 1 shell + 2 sections × 2 themes × 1 mobile viewport = 6 → 26 total.
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 375, height: 812 },
]

const THEMES = ['dark', 'light'] as const

const SECTIONS = ['top-nav', 'left-rail', 'main-pane', 'chat-dock'] as const

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`visual-regression ${vp.name} ${theme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      test(`shell + sections match baseline`, async ({ page, eventSub }) => {
        // Kill all motion so the shell-stagger and other entry animations
        // do not introduce pixel diffs between runs.
        await page.emulateMedia({ reducedMotion: 'reduce' })

        // Seed the theme before any page script runs so the inline
        // flash-prevention <script> in index.html reads the right value
        // and sets data-theme synchronously on <html>.
        await page.addInitScript((t: string) => {
          try {
            localStorage.setItem('tcl.theme', t)
          } catch {
            // ignore — Playwright contexts should always allow localStorage
          }
        }, theme)

        await openDemo(page, eventSub)

        // Belt-and-braces wait: the AppShell first-mount stagger is 800ms
        // (see AppShell.tsx). reducedMotion should suppress any CSS
        // transitions but the layout flag still flips at that timer.
        await page.waitForTimeout(900)

        // Full-page shell capture.
        await expect(page).toHaveScreenshot(`shell-${vp.name}-${theme}.png`, {
          maxDiffPixels: 80,
        })

        // Individual shell sections. Mobile skips rail + dock — see file
        // header for rationale.
        for (const section of SECTIONS) {
          if (
            vp.name === 'mobile' &&
            (section === 'left-rail' || section === 'chat-dock')
          ) {
            continue
          }
          const locator = page.locator(`[data-shell-section="${section}"]`).first()
          if (!(await locator.isVisible())) continue
          await expect(locator).toHaveScreenshot(
            `${section}-${vp.name}-${theme}.png`,
            { maxDiffPixels: 40 },
          )
        }
      })
    })
  }
}
