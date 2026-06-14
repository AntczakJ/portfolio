import { expect, test } from '@playwright/test';

import { armFromGate, gotoStage } from '@helpers/index';

/**
 * Mute (ADR-003 §1, reviewer H1) — after arming with the built-in synth,
 * toggling mute flips the store `muted` state. Audible silence is not assertable
 * headless (no real audio device + software-GL), so the contract under test is
 * the store/UI state: the mute control is bound directly to `store.muted` via
 * `aria-pressed` + its accessible name (Mute ↔ Unmute), so the button state IS
 * the store state, observably. Per H1 the master gain → 0 drops the analyser
 * feed too, so the field falls to its idle drift path — the canvas stays mounted
 * (the experience does not tear down on mute).
 */
test.describe('mute', () => {
  test('toggling mute after arming flips the store muted state (Mute ↔ Unmute, aria-pressed) @smoke', async ({
    page,
  }) => {
    await gotoStage(page);
    // Arm with the built-in synth (the default source).
    await armFromGate(page);

    // The default source is the synth (built-in), pressed.
    await expect(page.getByRole('button', { name: /^Synth$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Start unmuted.
    const mute = page.getByRole('button', { name: /^Mute$/ });
    await expect(mute).toBeVisible();
    await expect(mute).toHaveAttribute('aria-pressed', 'false');

    // Toggle to muted — store.muted flips true; the control reflects it.
    // Driven by KEYBOARD: the HUD sits over a continuously-animating
    // (software-GL headless) canvas, so a pointer click never settles
    // Playwright's post-action stability window. Keyboard activation is
    // deterministic and is also the faithful keyboard-operability assertion.
    await mute.focus();
    await page.keyboard.press('Enter');
    const unmute = page.getByRole('button', { name: /^Unmute$/ });
    await expect(unmute).toBeVisible();
    await expect(unmute).toHaveAttribute('aria-pressed', 'true');

    // The field idle path engages on mute — the experience stays armed (the
    // canvas is not torn down; the field drifts to idle rather than going dark).
    await expect(page.locator('html')).toHaveAttribute('data-armed', '');

    // Toggle back — store.muted flips false again.
    await unmute.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: /^Mute$/ }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});
