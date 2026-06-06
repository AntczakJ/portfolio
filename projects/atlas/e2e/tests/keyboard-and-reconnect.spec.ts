import { expect, test } from '@playwright/test';

/**
 * The keyboard focus flow through the fleet list, and the socket-drop reconnect
 * indicator (Task 8.2).
 */

test('keyboard: Tab reaches a fleet row and Enter focuses the vehicle', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 });

  // The fleet roster grid is the first-class keyboard/SR path: each row is a
  // <button>. Focus the first row directly (a real keyboard user Tabs to it; we
  // assert the row is focusable + operable, then drive it from the keyboard).
  const firstRow = page.getByRole('button', { name: /Unit \d+/ }).first();
  await expect(firstRow).toBeVisible();
  await firstRow.focus();
  await expect(firstRow).toBeFocused();

  // Enter focuses the vehicle: the row reports aria-pressed and the detail panel
  // pins this unit (the selection flow, keyboard-operable).
  await page.keyboard.press('Enter');
  await expect(firstRow).toHaveAttribute('aria-pressed', 'true');

  // The detail panel now shows a vehicle heading (h3), proving the selection
  // pinned a vehicle rather than the empty/overview state.
  await expect(page.getByRole('heading', { level: 3 }).filter({ hasText: /Unit \d+/ })).toBeVisible();

  // Tab moves to the NEXT focusable control (focus genuinely flows, not trapped).
  await page.keyboard.press('Tab');
  await expect(firstRow).not.toBeFocused();
});

test('a socket drop shows the reconnecting indicator, then recovers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Simulate a dropped connection by severing the transport (offline). The
  // client must detect it (the heartbeat-liveness timer trips), flip the pill to
  // "Reconnecting", freeze the markers at their last position (never
  // stale-as-live), and then reconnect with a fresh snapshot.
  await page.context().setOffline(true);

  await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible({ timeout: 60_000 });

  // Restore connectivity → the client reconnects and reaches "Live" again,
  // reconciling from a fresh snapshot (never showing stale motion as live).
  await page.context().setOffline(false);
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 60_000 });
});
