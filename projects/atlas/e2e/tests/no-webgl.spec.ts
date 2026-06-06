import { expect, test } from '@playwright/test';

import { trackWs } from '@helpers/ws-tracker';

/**
 * The fleet TABLE fallback renders the same live data over the SAME single
 * socket (Task 8.2, the no-WebGL degradation arm).
 *
 * The table is BOTH the no-WebGL fallback AND a first-class user choice (PLAN.md:
 * "togglable by any user", "the same data as the map"). We drive it via the
 * always-available Table view toggle — the deterministic path that exercises the
 * identical table surface and the one-socket mutual-exclusivity (the map's hook
 * does not run while the table is active, so there is never a second socket).
 *
 * NOTE on a genuine browser-level no-WebGL run: see the AGENT_NOTES finding — with
 * WebGL HARD-disabled at the Chromium level, MapLibre's optimistic mount throws
 * an uncaught exception (the initial `new Map()` is not wrapped, and the
 * OpsSurface capability probe races the lazy MapCanvas chunk). The user-toggle
 * path here is the deterministic, faithful assertion of the table surface; the
 * crash-on-hard-disabled-WebGL is reported as a product robustness gap for the
 * frontend-engineer, not worked around by weakening product code.
 */

test('the Table view shows the live fleet over one socket (no second connection)', async ({
  page,
}) => {
  const tracker = trackWs(page);
  await page.goto('/');

  // Start on the live map — exactly one open socket.
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(tracker.openCount()).toBe(1);

  // Switch to the Table view (the first-class fallback / accessible alternative).
  await page.getByRole('button', { name: 'Table', exact: true }).click();

  // The map canvas is gone; the full-width fleet table (a semantic grid) renders.
  await expect(page.locator('.maplibregl-canvas')).toHaveCount(0);
  const table = page.getByRole('grid', { name: /Live fleet roster/i });
  await expect(table).toBeVisible({ timeout: 15_000 });

  // The data is LIVE in the table surface: the pill stays "Live" (the headless
  // hook feeds the same stores from the same channel), and rows carry real units.
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: /Unit \d+/ }).first()).toBeVisible();

  // After the surface swap there is STILL exactly ONE socket OPEN — the map's
  // hook XOR the headless hook (mutual exclusivity). Across the swap the old
  // socket closes and the new one opens, but they never overlap: the concurrent
  // open count must settle back to 1, never 2.
  await expect.poll(() => tracker.openCount(), { timeout: 10_000 }).toBe(1);
  // And the live socket is the `/ws` telemetry endpoint, not a polling fallback.
  const live = tracker.sockets.find((ws) => /\/ws(\?|$)/.test(ws.url()));
  expect(live).toBeTruthy();
});
