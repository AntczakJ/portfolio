import { expect, test } from '@playwright/test';

import { armFromGate, attachDiagnostics, gotoStage } from '@helpers/index';

/**
 * Reduced motion (ADR-004 §2 / ADR-003 §2, planner hard rule #4) — under
 * `prefers-reduced-motion: reduce`:
 *   - audio NEVER auto-starts (the gate is still required; its label drops
 *     "sound on" because reactivity is muted on the calm route);
 *   - the calm route is selected (calm autonomous drift, not the full reactive
 *     field) and the aria-live alternative reports it;
 *   - nothing strobes — no media auto-plays, no AudioContext is created before
 *     the gesture;
 *   - the "Still" motion toggle is present + operable (freezes a composed
 *     frame).
 */
test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('no autoplay — the gate is still required and its label drops "sound on" @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    await gotoStage(page);

    // The gate is still required (audio never auto-starts under reduced motion).
    const beginButton = page.getByRole('button', { name: /press to begin/i });
    await expect(beginButton).toBeVisible();

    // The label drops the "sound on" promise (reactivity is muted on calm).
    const label = (await beginButton.textContent())?.toLowerCase() ?? '';
    expect(label).toContain('press to begin');
    expect(label, 'no "sound on" promise under reduced motion').not.toContain(
      'sound on',
    );

    // No media auto-plays and no AudioContext exists before the gesture.
    const playingMedia = await page.evaluate(() => {
      const media = Array.from(
        document.querySelectorAll<HTMLMediaElement>('audio, video'),
      );
      return media.filter((m) => !m.paused).length;
    });
    expect(playingMedia, 'nothing strobes / autoplays').toBe(0);

    expect(diag.cspViolations).toEqual([]);
    expect(diag.pageErrors).toEqual([]);
  });

  test('the aria-live alternative reports the calm reduced-motion state once armed', async ({
    page,
  }) => {
    await gotoStage(page);
    const live = page.locator('[aria-live="polite"]');

    // Pre-arm the description is the paused invitation (no autoplay).
    await expect(live).toContainText(/paused|press begin/i, { timeout: 10_000 });

    // Arm via the gate (keyboard). The calm route then reports the
    // reduced-motion drift with reactivity muted.
    await armFromGate(page);
    await expect(live).toContainText(
      /drifting calmly.*reduced motion|reactivity muted for reduced motion/i,
      { timeout: 10_000 },
    );
  });

  test('the "Still" motion toggle is present + operable, and returns to the still poster surface', async ({
    page,
  }) => {
    await gotoStage(page);
    await armFromGate(page);

    // The Still toggle is a real, keyboard-operable control. Activating it is
    // the user asking for ZERO motion → the route resolves to the poster (the
    // composed still), so the field loop stops and the HUD tears down. The
    // deterministic outcome is the return to the still surface: `data-armed` is
    // removed and the canvas is gone (ADR-004 §2: "Still" wins → poster).
    const still = page.getByRole('button', { name: /still motion/i });
    await expect(still).toBeVisible();
    await still.focus();
    await expect(still).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('html')).not.toHaveAttribute('data-armed', '');
    await expect(page.locator('canvas')).toHaveCount(0);
    // The readable still surface (the SSR directory) is shown again.
    await expect(
      page
        .locator('[data-nojs-fallback]')
        .getByRole('heading', { level: 1, name: /nocturne/i }),
    ).toBeVisible();
  });
});
