import { expect, test } from '@playwright/test';

import { TapeApp } from '@helpers/tape-app';
import {
  buildFootprintSnapshot,
  SNAPSHOT_CLOSED_CELL_COUNT,
  SNAPSHOT_TICK_COUNT,
} from '../fixtures/footprint-snapshot';

/**
 * Critical path 1 (Task 5.3) — live mode loads and the footprint
 * renders, deterministically.
 *
 * We mock `/ws/stream` (so the connection state reaches `connected`
 * against a controlled socket) and seed a fixed footprint snapshot via
 * the dev-only `window.__tapeStore` hook. This is the CI-gated path:
 * no Docker, no backend, no flakiness from a real synth stream.
 *
 * Asserts:
 *   - the app shell renders (chart region + status bar present),
 *   - the store ingests the snapshot (closed cells + ticks counted),
 *   - the Canvas2D footprint actually paints (non-blank canvas),
 *   - the status bar reflects the connected state.
 */
test.describe('live mode — footprint renders (injected, deterministic)', () => {
  test('seeded snapshot paints footprint cells + tape strip', async ({
    page,
  }) => {
    const app = new TapeApp(page);
    await app.mockWebSocket();
    await app.goto();

    // Shell is present.
    await expect(app.chartRegion()).toBeVisible();
    await expect(app.statusBar()).toBeVisible();

    // The dev store hook must be exposed (proves we are on a dev build,
    // which the injected path requires).
    await app.waitForStoreHook();

    // Inject the deterministic footprint snapshot + mark connected.
    const counts = buildFootprintSnapshot();
    const result = await app.injectSnapshot(counts);

    expect(result.closedCells).toBe(SNAPSHOT_CLOSED_CELL_COUNT);
    expect(result.recentTicks).toBe(SNAPSHOT_TICK_COUNT);
    expect(result.connectionState).toBe('connected');

    // The Canvas2D footprint must paint the injected cells (non-blank).
    await app.expectCanvasPainted();

    // The status bar's WS cell mirrors the connected state. The pip's
    // text label ("connected") lives in a polite live region.
    await expect(app.statusBar().getByText('connected')).toBeVisible();
  });

  test('status starts non-connected before injection (mock opens it)', async ({
    page,
  }) => {
    // Without the WS mock, the live provider points at a dead port and
    // sits in connecting/reconnecting — never "connected". This guards
    // that our deterministic "connected" really comes from the mock +
    // injection, not from an accidental live backend.
    const app = new TapeApp(page);
    await app.goto();
    await app.waitForStoreHook();

    const state = await app.storeField<string>('connectionState');
    expect(['idle', 'connecting', 'reconnecting']).toContain(state);
  });
});
