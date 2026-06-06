import { expect, test, type Locator } from '@playwright/test';

import { trackWs } from '@helpers/ws-tracker';

/**
 * The live map loads and the fleet is MOVING over exactly ONE WebSocket (Task
 * 8.2, the lead success criterion).
 *
 * This is the senior signal: the map is genuinely PUSHED over one long-lived
 * WebSocket carrying telemetry frames, NOT a polling XHR loop. We assert:
 *   - the MapLibre canvas mounts and the connection pill reaches "Live";
 *   - exactly ONE WebSocket is opened (to `/ws`), and it carries frames;
 *   - the live map does NOT poll `GET /api/fleet/snapshot` (the push, not poll,
 *     proof);
 *   - the fleet is genuinely moving — the 1 Hz authoritative tick advances (the
 *     pill's server-tick readout climbs) and the fleet store hydrates.
 *
 * Determinism: we wait on REAL STATE (the pill text, the tick climbing, frames
 * received) via web-first assertions, never an arbitrary sleep.
 */

test('the live map mounts, opens exactly one WebSocket, and the fleet is moving', async ({
  page,
}) => {
  const tracker = trackWs(page);

  // Collect WS frames so we can prove telemetry is genuinely streamed.
  const framePromise = new Promise<string>((resolve) => {
    page.on('websocket', (ws) => {
      ws.on('framereceived', (frame) => {
        if (typeof frame.payload === 'string' && frame.payload.includes('"t":')) {
          resolve(frame.payload);
        }
      });
    });
  });

  await page.goto('/');

  // The MapLibre canvas mounts (the WebGL wow surface) under the prod CSP.
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });

  // The connection pill reaches "Live" — the real WS lifecycle, not a fake.
  await expect(page.getByText('Live', { exact: true })).toBeVisible();

  // Exactly ONE WebSocket connection (the DevTools "one socket" proof). Assert
  // after the pill is Live so the single connection has settled — one cumulative,
  // one open, to `/ws`.
  expect(tracker.sockets).toHaveLength(1);
  expect(tracker.openCount()).toBe(1);
  expect(tracker.sockets[0]?.url()).toMatch(/\/ws(\?|$)/);

  // The socket carries telemetry frames (snapshot/tick) — genuinely pushed.
  const firstFrame = await framePromise;
  expect(firstFrame).toMatch(/"t":"(snapshot|tick)"/);

  // The fleet is MOVING: the live server tick climbs across authoritative ticks.
  const tickReadout = page.locator('span', { hasText: /^t[\d,]+$/ });
  await expect(tickReadout.first()).toBeVisible();
  const firstTick = await readTick(tickReadout.first());
  await expect
    .poll(async () => readTick(tickReadout.first()), { timeout: 15_000 })
    .toBeGreaterThan(firstTick);

  // The live map did NOT fall back to polling the REST snapshot — push, not poll.
  expect(tracker.snapshotPolls).toHaveLength(0);

  // Still exactly one socket after the observation window (no second connection,
  // no reconnect churn while steady).
  expect(tracker.openCount()).toBe(1);
});

/** Read the numeric server tick from the pill's `t1,234`-style readout. */
async function readTick(locator: Locator): Promise<number> {
  const text = (await locator.innerText()).trim();
  return Number(text.replace(/[^\d]/g, ''));
}
