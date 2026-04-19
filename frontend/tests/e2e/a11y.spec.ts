import { test, expect, openDemo } from './fixtures'
import { injectAxe, getViolations } from 'axe-playwright'
import type { Page } from '@playwright/test'

const setThemeAndReload = async (page: Page, theme: 'dark' | 'light') => {
  // Collapse the shell's first-mount fade/slide animations via the global
  // `prefers-reduced-motion: reduce` media query — otherwise axe can sample
  // partially-transparent text during the 360–720ms stagger and report
  // false-positive color-contrast failures.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate((t) => localStorage.setItem('tcl.theme', t), theme)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(theme)
}

// Axe rules we deliberately exclude. Document WHY inline when adding entries.
// Keep empty by default and add only after observing a real false positive.
const AXE_RUN_OPTIONS = {
  rules: {},
}

const auditPage = async (page: Page) => {
  await injectAxe(page)
  const violations = await getViolations(page, undefined, AXE_RUN_OPTIONS)
  const blocking = violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  )
  if (blocking.length > 0) {
    // Emit a readable diff on failure. Playwright's default reporter prints this.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(blocking, null, 2))
  }
  return blocking
}

test.describe('Phase 7 a11y audit — dark', () => {
  test('no critical/serious violations on full page (dark)', async ({ page, eventSub }) => {
    await openDemo(page, eventSub)
    await setThemeAndReload(page, 'dark')
    const blocking = await auditPage(page)
    expect(blocking, 'critical + serious axe violations (dark)').toEqual([])
  })
})

test.describe('Phase 7 a11y audit — light', () => {
  test('no critical/serious violations on full page (light)', async ({ page, eventSub }) => {
    await openDemo(page, eventSub)
    await setThemeAndReload(page, 'light')
    const blocking = await auditPage(page)
    expect(blocking, 'critical + serious axe violations (light)').toEqual([])
  })
})
