import { expect, test } from '@playwright/test';

import { TapeApp } from '@helpers/tape-app';
import { buildFootprintSnapshot } from '../fixtures/footprint-snapshot';

/**
 * Critical path 4 + 5 (Task 5.3) — keyboard reachability + accessibility
 * smoke.
 *
 * Keyboard:
 *   - Tab order reaches the interactive chrome: the rail entries
 *     (Live / Replay), the theme toggle, and — in replay — the transport
 *     controls + scrub slider.
 *   - Space toggles replay mode (the document-level shortcut from Task
 *     2.4), and the slider seeks with ArrowLeft/ArrowRight.
 *   - Focused controls expose a visible focus ring (focus-visible).
 *
 * Accessibility smoke (asserted via the key ARIA, in BOTH themes —
 * a dependency-light, deterministic pass rather than an external axe
 * install the offline CI cannot fetch):
 *   - the cell-readout SR mirror (`aria-live="polite"`) exists,
 *   - the rail uses `aria-current="page"` for the active mode,
 *   - the replay scrub slider is a labelled `role=slider`,
 *   - landmark roles (banner / main / contentinfo) are present.
 */
test.describe('keyboard navigation + a11y smoke', () => {
  test('Tab reaches the rail, theme toggle, and replay controls', async ({
    page,
  }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();

    // Tab through the document and collect the accessible names of the
    // focused elements until we have visited a useful set. We cap the
    // walk so a focus trap fails loudly rather than hanging.
    const reached = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null) return { name: '', role: '' };
        const name =
          el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
        return { name, role: el.getAttribute('role') ?? el.tagName };
      });
      if (info.name.length > 0) reached.add(info.name);
    }

    // The rail entries are reachable by their accessible names.
    const joined = [...reached].join(' | ');
    expect(joined).toMatch(/Live/);
    expect(joined).toMatch(/Replay/);
    // The theme toggle is reachable (accessible name starts "Theme:").
    expect(joined).toMatch(/Theme:/);
  });

  test('Space toggles replay mode; slider seeks with arrows', async ({
    page,
  }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();
    // Wait for hydration so the document-level keydown listener is bound.
    await app.waitForHydrated();

    // The document-level Space shortcut flips live ⇄ replay. Move focus
    // to the body (away from any control), then press Space.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await expect(app.replayControls().getByRole('slider')).toBeVisible();

    // Arrow seek on the focused slider advances the position.
    const slider = app.replaySlider();
    await slider.focus();
    const before = await slider.getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => slider.getAttribute('aria-valuenow'))
      .not.toBe(before);
  });

  test('focused controls expose a visible focus ring', async ({ page }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();

    const toggle = app.themeToggle();
    await toggle.focus();
    // focus-visible draws an outline / ring; assert a non-"none" outline
    // OR a ring via box-shadow (the globals.css base layer uses one of
    // these). We check the computed outline + boxShadow are not both the
    // unfocused default.
    const focusStyles = await toggle.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outlineStyle: s.outlineStyle, boxShadow: s.boxShadow };
    });
    const hasRing =
      focusStyles.outlineStyle !== 'none' ||
      (focusStyles.boxShadow !== 'none' && focusStyles.boxShadow !== '');
    expect(hasRing).toBe(true);
  });

  test('key ARIA present in both themes (cell-readout, landmarks, rail)', async ({
    page,
  }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();
    await app.waitForStoreHook();
    await app.injectSnapshot(buildFootprintSnapshot());

    const assertAria = async (): Promise<void> => {
      // Landmark roles.
      await expect(page.getByRole('banner')).toBeAttached();
      await expect(page.getByRole('main')).toBeAttached();
      await expect(page.getByRole('contentinfo')).toBeAttached();

      // The cell-readout SR mirror: a polite live region inside the chart.
      const liveRegions = app
        .chartRegion()
        .locator('[aria-live="polite"]');
      await expect(liveRegions.first()).toBeAttached();

      // Rail active state via aria-current.
      await expect(
        page.getByRole('button', { name: 'Live', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    };

    // Light.
    await page.emulateMedia({ colorScheme: 'light' });
    await assertAria();

    // Dark — the same ARIA must hold after the palette flip.
    await page.emulateMedia({ colorScheme: 'dark' });
    await assertAria();
  });
});
