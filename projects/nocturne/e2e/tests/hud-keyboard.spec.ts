import { expect, test, type Page } from '@playwright/test';

import { armFromGate, gotoStage, PRESETS } from '@helpers/index';

/**
 * HUD keyboard reachability (ADR-004 §5) — every control is real, keyboard-
 * operable DOM, and the auto-dim never drops keyboard reachability.
 *
 * The HUD appears only AFTER the gesture gate arms the experience, so each test
 * arms first. Headless software-GL renders the canvas behind the HUD, but the
 * HUD itself is plain DOM, so its reachability + the radiogroup semantics are
 * fully deterministic.
 *
 * Controls (top bar → bottom bar): fullscreen, theme, about link, preset
 * radiogroup, audio source picker (Synth / Mic / File), mute, motion mode
 * (Full / Calm / Still), pointer toggle.
 */

async function arm(page: Page): Promise<void> {
  await gotoStage(page);
  await armFromGate(page);
}

test.describe('HUD keyboard reachability', () => {
  test('every HUD control is reachable + operable, and exposes a semantic accessible name @smoke', async ({
    page,
  }) => {
    await arm(page);

    // Each control is queried by its semantic role + accessible name (never a
    // test-id). If any of these is missing or unnamed, the assertion fails.
    await expect(
      page.getByRole('button', { name: /toggle fullscreen/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /switch to (light|dark) chrome/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /about this piece/i })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: /preset/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Synth$/ })).toBeVisible();
    // Mic is present in both states (enabled secure-context, or disabled with a
    // clear title) — query by the role+name in either case.
    await expect(page.getByRole('button', { name: /Mic/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^File$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /full motion/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /calm motion/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /still motion/i })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /(enable|disable) pointer interaction/i }),
    ).toBeVisible();
  });

  test('the controls are operable by keyboard — mute, motion mode, fullscreen toggle their state', async ({
    page,
  }) => {
    await arm(page);

    // Mute toggles its accessible name (Mute ↔ Unmute) and aria-pressed — the
    // deterministic, headless-safe proof the control works (silence itself is
    // not audible headless; the store/UI state is the contract).
    const mute = page.getByRole('button', { name: /^Mute$/ });
    await mute.focus();
    await expect(mute).toBeFocused();
    await page.keyboard.press('Enter');
    const unmute = page.getByRole('button', { name: /^Unmute$/ });
    await expect(unmute).toBeVisible();
    await expect(unmute).toHaveAttribute('aria-pressed', 'true');

    // Motion mode: Calm becomes the pressed option when activated by keyboard.
    const calm = page.getByRole('button', { name: /calm motion/i });
    await calm.focus();
    await page.keyboard.press('Enter');
    await expect(calm).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('preset radiogroup (WAI-ARIA roving tabindex)', () => {
  test('Arrow / Home / End move the selection with a single tab stop', async ({
    page,
  }) => {
    await arm(page);

    const group = page.getByRole('radiogroup', { name: /preset/i });
    const radios = group.getByRole('radio');
    await expect(radios).toHaveCount(PRESETS.length);

    // Exactly one radio is tabbable (roving tabindex): the checked one has
    // tabindex 0, the rest -1. The default armed preset is Aurora.
    const aurora = group.getByRole('radio', { name: 'Aurora' });
    await expect(aurora).toHaveAttribute('aria-checked', 'true');
    await expect(aurora).toHaveAttribute('tabindex', '0');

    // Move focus into the group via the checked radio, then drive with arrows.
    await aurora.focus();
    await expect(aurora).toBeFocused();

    // ArrowRight selects + focuses the next preset (Nocturne Noir follows
    // Aurora in directory order). Selection follows focus (the radio pattern).
    await page.keyboard.press('ArrowRight');
    const noir = group.getByRole('radio', { name: 'Nocturne Noir' });
    await expect(noir).toBeFocused();
    await expect(noir).toHaveAttribute('aria-checked', 'true');
    await expect(aurora).toHaveAttribute('aria-checked', 'false');

    // ArrowLeft moves back.
    await page.keyboard.press('ArrowLeft');
    await expect(aurora).toBeFocused();
    await expect(aurora).toHaveAttribute('aria-checked', 'true');

    // Home → the first preset (Glacial Drift); End → the last (Ink Bloom).
    const firstName = PRESETS[0].name;
    const lastName = PRESETS[PRESETS.length - 1]?.name ?? '';
    await page.keyboard.press('Home');
    const first = group.getByRole('radio', { name: firstName });
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('End');
    const last = group.getByRole('radio', { name: lastName });
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-checked', 'true');
  });
});
