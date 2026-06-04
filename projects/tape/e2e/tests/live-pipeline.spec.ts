import { expect, test } from '@playwright/test';

import { TapeApp } from '@helpers/tape-app';
import { liveEnabled } from '@helpers/env';

/**
 * Task 5.3 — REAL pipeline E2E (tagged @live, opt-in).
 *
 * Skipped unless `TAPE_E2E_LIVE=1`. Requires the offline synth→worker
 * pipeline to be up and `tape-web` pointed at it (see the e2e README run
 * recipe). It does NOT mock the WebSocket — it lets the live
 * `WSStreamProvider` connect to a real `/ws/stream` and asserts that
 * live frames actually render:
 *
 *   - the connection reaches `connected`,
 *   - the snapshot + live `tick` / `cell.*` frames accrue in the store,
 *   - the Canvas2D footprint paints.
 *
 * This is the bonus, environment-dependent proof. The deterministic
 * injected specs are the CI gate (no Docker). Keeping this opt-in means a
 * missing pipeline does not redden the suite.
 */
test.describe('live pipeline — real /ws/stream renders frames @live', () => {
  test.skip(!liveEnabled(), 'TAPE_E2E_LIVE != 1 — real pipeline not running');

  test('connects, accrues frames, paints the footprint', async ({ page }) => {
    test.setTimeout(90_000);

    const app = new TapeApp(page);
    // No mockWebSocket() — connect to the real server.
    await app.goto();
    await app.waitForStoreHook();

    // The WS reaches connected.
    await expect
      .poll(() => app.storeField<string>('connectionState'), {
        timeout: 30_000,
        message: 'live WS never reached connected — is the pipeline up?',
      })
      .toBe('connected');

    // Live ticks accrue (the synth drives ~5/sec; give it room).
    await expect
      .poll(() => app.storeField<number>('tickCount'), {
        timeout: 30_000,
        message: 'no live ticks arrived from the pipeline',
      })
      .toBeGreaterThan(0);

    // The footprint paints the live cells.
    await app.expectCanvasPainted();

    // The status bar reflects the live connection.
    await expect(app.statusBar().getByText('connected')).toBeVisible();
  });
});
