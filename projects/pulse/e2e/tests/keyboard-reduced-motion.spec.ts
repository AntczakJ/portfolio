import { expect, test } from '@playwright/test';

import {
  BoardPage,
  freshIdentity,
  signOut,
  signUpThroughDialog,
} from '@helpers/index';

/**
 * Test 7 — keyboard operation + reduced-motion smoke.
 *
 * Accessibility is a success criterion (WCAG 2.2 AA, full keyboard nav,
 * `prefers-reduced-motion` respected). This is a smoke pass, not exhaustive:
 *   - the create-monitor dialog is keyboard-operable (focus trap, labelled
 *     fields, Escape closes),
 *   - reduced-motion does not break the live board (it still connects + renders).
 */
test.describe('accessibility — keyboard + reduced-motion', () => {
  test('the create-monitor dialog is keyboard-operable', async ({ page }) => {
    const board = new BoardPage(page);
    const identity = freshIdentity();

    await board.goto();
    await expect(board.cards().first()).toBeVisible({ timeout: 15_000 });

    // Sign up first so the create dialog is reachable (the demo gates the write).
    await board.newMonitorButton().click();
    await signUpThroughDialog(page, identity);

    // Open the create dialog and drive it by keyboard.
    await board.newMonitorButton().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('New monitor')).toBeVisible();

    // The Name field is reachable + fillable; tab moves to the next field.
    const nameField = dialog.getByLabel('Name');
    await nameField.focus();
    await expect(nameField).toBeFocused();
    await page.keyboard.type(`KB monitor ${Date.now().toString(36)}`);
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Target URL')).toBeFocused();

    // Escape closes the dialog (focus trap + dismiss) and returns to the board.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Sign out to leave the shared demo clean for the next spec.
    await signOut(page);
  });

  test('reduced-motion does not break the board', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const board = new BoardPage(page);

    await board.goto();
    // The board renders + connects with motion collapsed to instant.
    await expect(board.cards().first()).toBeVisible({ timeout: 15_000 });
    await board.waitForLive();
    // Status remains accessible (text label present, not motion-dependent).
    await expect(board.section()).toContainText(/Up|Down|Degraded|Unknown/);
  });
});
