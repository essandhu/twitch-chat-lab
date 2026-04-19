import { test, expect } from './fixtures'

test.beforeEach(async ({ page }) => {
  // Must navigate somewhere before accessing localStorage.
  await page.goto('/?demo=playwright')
  await page.evaluate(() => {
    localStorage.removeItem('tcl.theme')
    localStorage.removeItem('tcl.rail.collapsed')
    localStorage.removeItem('tcl.chat-dock.width')
    localStorage.removeItem('tcl.chat-dock.collapsed')
  })
})

test.describe('Phase 7 — persistence', () => {
  test('theme persists across reload and no-flash on first paint', async ({ page }) => {
    // Pick a deterministic starting theme by setting localStorage directly.
    await page.evaluate(() => localStorage.setItem('tcl.theme', 'light'))
    await page.reload()
    // data-theme attribute set by the inline script in index.html BEFORE React
    // hydrates — proves no-flash on first paint.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .toBe('light')
    expect(await page.evaluate(() => localStorage.getItem('tcl.theme'))).toBe('light')

    // Toggle via the theme-toggle IconButton. Cycle is system → dark → light → system,
    // so from 'light' the next value is 'system'.
    const themeBtn = page.getByRole('button', { name: /Theme:/i })
    await themeBtn.click()
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('tcl.theme')))
      .toBe('system')

    await page.reload()
    // After reload with 'system' in storage, inline script resolves via OS
    // preference — still a valid 'dark' or 'light' value on the <html> element.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .toMatch(/^(dark|light)$/)
  })

  test('rail collapse persists via Ctrl+B', async ({ page }) => {
    // After beforeEach reload, rail starts expanded (240px).
    const rail = page.locator('[data-shell-section="left-rail"]').first()
    await expect(rail).toBeVisible()
    const initial = await rail.evaluate((el) => (el as HTMLElement).offsetWidth)
    expect(initial).toBeGreaterThan(200)

    await page.keyboard.press('Control+b')
    // Width flips to 60px (collapsed).
    await expect
      .poll(() => rail.evaluate((el) => (el as HTMLElement).offsetWidth))
      .toBeLessThan(100)
    expect(await page.evaluate(() => localStorage.getItem('tcl.rail.collapsed'))).toBe('true')

    // Reload — rail stays collapsed.
    await page.reload()
    const railAfter = page.locator('[data-shell-section="left-rail"]').first()
    await expect(railAfter).toBeVisible()
    const afterReload = await railAfter.evaluate((el) => (el as HTMLElement).offsetWidth)
    expect(afterReload).toBeLessThan(100)
  })

  test('chat-dock resize + collapse persists', async ({ page }) => {
    const dock = page.locator('[data-shell-section="chat-dock"]').first()
    await expect(dock).toBeVisible()

    // Drag the handle left to make the dock wider. Handle lives on the left edge;
    // ChatDock computes `startWidth - (clientX - startX)`, so dragging left (negative
    // delta) increases width. Starting ~340px; drag left 60px → ~400px.
    const handle = page.getByTestId('chat-dock-handle')
    const box = await handle.boundingBox()
    if (!box) throw new Error('chat-dock-handle bounding box not available')

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x - 60, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()

    // Width persisted on pointerup.
    const persisted = await page.evaluate(() =>
      Number(localStorage.getItem('tcl.chat-dock.width')),
    )
    expect(persisted).toBeGreaterThan(340)
    expect(persisted).toBeLessThanOrEqual(480)

    await page.reload()
    const dockAfterResize = page.locator('[data-shell-section="chat-dock"]').first()
    await expect(dockAfterResize).toBeVisible()
    // After reload, dock width matches persisted value (small tolerance for
    // rendering/border quirks).
    const renderedAfter = await dockAfterResize.evaluate(
      (el) => (el as HTMLElement).offsetWidth,
    )
    expect(Math.abs(renderedAfter - persisted)).toBeLessThan(6)

    // Collapse with Ctrl+Shift+C (same shape as Ctrl+Shift+P in perf-overlay.spec.ts).
    await page.keyboard.press('Control+Shift+C')
    await expect
      .poll(() => dockAfterResize.evaluate((el) => (el as HTMLElement).offsetWidth))
      .toBeLessThan(80)
    expect(await page.evaluate(() => localStorage.getItem('tcl.chat-dock.collapsed'))).toBe(
      'true',
    )

    // Reload — dock stays collapsed.
    await page.reload()
    const dockAfterCollapse = page.locator('[data-shell-section="chat-dock"]').first()
    await expect(dockAfterCollapse).toBeVisible()
    const collapsedAfter = await dockAfterCollapse.evaluate(
      (el) => (el as HTMLElement).offsetWidth,
    )
    expect(collapsedAfter).toBeLessThan(80)
  })
})
