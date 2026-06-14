import { expect, test } from '@playwright/test';

import { attachDiagnostics, gotoStage } from '@helpers/index';

/**
 * The intro gesture gate (ADR-003 §2) — the autoplay-policy contract turned
 * into the designed five-second-wow gate.
 *
 * The page loads to the intro overlay with NO autoplay: the wordmark + a real,
 * focusable "Press to begin" `<button>` are present, the button is keyboard-
 * activatable, and activating it ARMS the experience (the gate is replaced by
 * the HUD — the begin button disappears and the preset radiogroup takes over).
 *
 * Note on `data-armed`: the Stage sets `data-armed` on <html> as soon as the
 * capability probe resolves to a non-poster route — i.e. it is the "a live/calm
 * surface is mounted (not the poster)" signal, NOT the gesture-arm signal. The
 * gesture-arm signal is the gate→HUD swap, which is what `armFromGate` waits on.
 *
 * Headless note: the live 60fps field behind the gate is software-GL and is NOT
 * asserted here — only the gate's DOM contract and the arm transition, which are
 * deterministic.
 */
test.describe('intro gesture gate', () => {
  test('the page loads to the intro overlay — wordmark + a real begin button, no autoplay @smoke', async ({
    page,
  }) => {
    const diag = await attachDiagnostics(page);
    await gotoStage(page);

    // The intro gate is present: a real, focusable begin button.
    const beginButton = page.getByRole('button', { name: /press to begin/i });
    await expect(beginButton).toBeVisible();

    // The HUD has NOT taken over yet (the gate, not the HUD, is showing): no
    // preset radiogroup before the gesture.
    await expect(page.getByRole('radiogroup', { name: /preset/i })).toHaveCount(
      0,
    );

    // No audio auto-starts before the gesture (ADR-003 §2: the AudioContext is
    // created lazily on the first gesture). No <audio>/<video> is auto-playing.
    const playingMedia = await page.evaluate(() => {
      const media = Array.from(
        document.querySelectorAll<HTMLMediaElement>('audio, video'),
      );
      return media.filter((m) => !m.paused).length;
    });
    expect(playingMedia, 'no media auto-plays before the gesture').toBe(0);

    expect(diag.cspViolations, 'no CSP violations on /').toEqual([]);
    expect(diag.pageErrors, 'no page errors on /').toEqual([]);
  });

  test('the begin button is keyboard-activatable (Enter) and arms the experience', async ({
    page,
  }) => {
    await gotoStage(page);

    const beginButton = page.getByRole('button', { name: /press to begin/i });
    await expect(beginButton).toBeVisible();

    // Focus the button and activate it by keyboard (Enter) — the gate must be
    // operable without a pointer (ADR-003 §2: a real focusable button, not a
    // canvas click target).
    await beginButton.focus();
    await expect(beginButton).toBeFocused();
    await page.keyboard.press('Enter');

    // Arming swaps the gate for the HUD: the begin button is gone and the HUD's
    // preset radiogroup is now present (the deterministic armed-by-gesture
    // proxy; the live GPU surge is software-GL and not asserted).
    await expect(beginButton).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.getByRole('radiogroup', { name: /preset/i }),
    ).toBeVisible();
  });

  test('the begin button is also activatable by Space', async ({ page }) => {
    await gotoStage(page);
    const beginButton = page.getByRole('button', { name: /press to begin/i });
    await beginButton.focus();
    await page.keyboard.press('Space');
    await expect(beginButton).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.getByRole('radiogroup', { name: /preset/i }),
    ).toBeVisible();
  });
});
