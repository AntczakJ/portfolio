import { expect, test } from '@playwright/test';

import { armFromGate, gotoStage } from '@helpers/index';

/**
 * Accessibility (ADR-004 §5):
 *   - the canvas is decorative (`aria-hidden`) — the meaning lives in the DOM +
 *     the aria-live alternative, not the pixels;
 *   - an `aria-live="polite"` text alternative is present and UPDATES with the
 *     preset + source (the screen-reader view of the field);
 *   - `/about` is keyboard-navigable (skip link → headings → links).
 */
test.describe('a11y — the decorative canvas + the text alternative', () => {
  test('the canvas is aria-hidden and the aria-live alternative is present @smoke', async ({
    page,
  }) => {
    await gotoStage(page);
    await armFromGate(page);

    // The live canvas, once mounted, is decorative.
    const canvas = page.locator('canvas');
    await expect(canvas).toHaveCount(1);
    // The canvas (or an aria-hidden ancestor R3F wraps it in) is removed from the
    // a11y tree. Assert via accessibility: a decorative canvas exposes no
    // accessible name/role to AT.
    const canvasHidden = await canvas.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node) {
        if (node.getAttribute('aria-hidden') === 'true') return true;
        node = node.parentElement;
      }
      return false;
    });
    expect(canvasHidden, 'canvas is aria-hidden (decorative)').toBe(true);

    // The aria-live alternative exists and describes the field.
    const live = page.locator('[aria-live="polite"]');
    await expect(live).toBeAttached();
    await expect(live).toContainText(/field|particle|nocturne|aurora/i);
  });

  test('the aria-live alternative updates when the preset changes', async ({
    page,
  }) => {
    await gotoStage(page);
    await armFromGate(page);

    const live = page.locator('[aria-live="polite"]');
    // The default armed preset is Aurora.
    await expect(live).toContainText(/aurora/i);

    // Switch the preset to Molten Swirl via the radiogroup, driven by KEYBOARD
    // (the canvas is continuously animating, so a pointer click never settles
    // Playwright's stability window — keyboard is both deterministic and the
    // faithful keyboard-operability assertion). The description tracks the
    // preset being transitioned toward (the picker leads the field).
    const molten = page.getByRole('radio', { name: 'Molten Swirl' });
    await molten.focus();
    await page.keyboard.press('Enter');
    await expect(live).toContainText(/molten swirl/i, { timeout: 10_000 });
  });
});

test.describe('a11y — /about keyboard navigation', () => {
  test('/about exposes a skip link, semantic headings, and keyboard-reachable links', async ({
    page,
  }) => {
    await page.goto('/about');

    // The skip link is the first focusable element and reveals on focus.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to content/i });
    await expect(skip).toBeFocused();

    // The page has a single h1 + the section headings as real landmarks.
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /the technique/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /credits/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /accessibility/i })).toBeVisible();

    // The "Enter the experience" link back to / is keyboard-reachable.
    const enterLink = page.getByRole('link', { name: /enter the experience/i });
    await expect(enterLink).toBeVisible();
    await enterLink.focus();
    await expect(enterLink).toBeFocused();
  });
});
