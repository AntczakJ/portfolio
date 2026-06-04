import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { FootprintSnapshot } from '../fixtures/footprint-snapshot';

/**
 * `tape-app.ts` — Page Object for the tape dashboard (`/`).
 *
 * The dashboard is a single-route app: top bar, side rail (Live /
 * Replay), the Canvas2D footprint chart + CVD sub-pane, the tape strip,
 * the replay control bar, and the status bar. This POM exposes the
 * semantic locators (role / label based, never `data-testid` when a
 * semantic query works) plus the two deterministic test seams:
 *
 *   - `mockWebSocket()` — stands in for `/ws/stream` so the connection
 *     state transitions to `connected` against a controlled mock rather
 *     than a real (absent) backend. The mock accepts and STAYS OPEN; it
 *     never sends frames, so it cannot fight the store. We feed the
 *     chart through `injectSnapshot` instead.
 *
 *   - `injectSnapshot()` / `__tapeStore` reads — the dev-only window
 *     hook (`stream-store.ts`, gated on NODE_ENV==='development') lets us
 *     seed a deterministic footprint without the Binance→worker→WS
 *     pipeline. `ingestSnapshot` REBUILDS store state from the payload,
 *     so the chart's engine (subscribed to the store) repaints the
 *     seeded cells on the next rAF tick.
 *
 * Canvas assertions use pixel sampling (`canvasHasPaintedContent`)
 * because the footprint is drawn imperatively — there are no per-cell
 * DOM nodes to query. We assert "the canvas is not blank" (a non-trivial
 * count of non-background pixels), which is the honest E2E-level signal
 * that the renderer painted the injected data.
 */
export class TapeApp {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /* ----------------------------- navigation ---------------------------- */

  async goto(): Promise<void> {
    await this.page.goto('/', { waitUntil: 'domcontentloaded' });
  }

  /* ------------------------------ locators ----------------------------- */

  /** The footprint chart container (`aria-label="Footprint chart"`). */
  chartRegion(): Locator {
    return this.page.getByLabel('Footprint chart');
  }

  /** The footprint `<canvas>` inside the chart region. */
  chartCanvas(): Locator {
    return this.chartRegion().locator('canvas');
  }

  /** The Live rail entry (button, role + accessible name). */
  liveRailEntry(): Locator {
    return this.page.getByRole('button', { name: 'Live', exact: true });
  }

  /** The Replay rail entry. */
  replayRailEntry(): Locator {
    return this.page.getByRole('button', { name: 'Replay', exact: true });
  }

  /** The replay control bar section (`aria-label="Replay controls"`). */
  replayControls(): Locator {
    return this.page.getByRole('region', { name: 'Replay controls' });
  }

  /** Replay scrub slider (role=slider, labelled "Replay scrub position"). */
  replaySlider(): Locator {
    return this.replayControls().getByRole('slider');
  }

  playButton(): Locator {
    return this.page.getByRole('button', { name: 'Play replay' });
  }

  pauseButton(): Locator {
    return this.page.getByRole('button', { name: 'Pause replay' });
  }

  stopButton(): Locator {
    return this.page.getByRole('button', {
      name: 'Stop replay and return to session start',
    });
  }

  /** Theme toggle (footer button; accessible name starts "Theme:"). */
  themeToggle(): Locator {
    return this.page.getByRole('button', { name: /^Theme:/ });
  }

  /** The status bar footer (role=contentinfo). */
  statusBar(): Locator {
    return this.page.getByRole('contentinfo');
  }

  /* ----------------------- deterministic WS mock ----------------------- */

  /**
   * Install a mock for `/ws/stream` BEFORE navigation. The mock accepts
   * the upgrade and keeps the socket open without connecting to any real
   * server and without sending frames — this drives the client's
   * `open` event so the store flips to `connected` deterministically.
   *
   * Must be called before `goto()`.
   */
  async mockWebSocket(): Promise<void> {
    await this.page.routeWebSocket(/\/ws\/stream/, (ws) => {
      // Accept and hold open. Drop any client message silently (the v1
      // client never sends). Do NOT connectToServer — there is none.
      ws.onMessage(() => {
        /* no-op: client is receive-only in v1 */
      });
    });
  }

  /* --------------------------- store seam ------------------------------ */

  /**
   * Inject a deterministic snapshot via the dev-only `window.__tapeStore`
   * hook and mark the connection `connected`. Returns the store's
   * post-injection counts for assertion.
   *
   * `ingestSnapshot` rebuilds the cell map + tick ring + CVD from the
   * payload; the chart engine repaints on its next rAF tick.
   */
  async injectSnapshot(snapshot: FootprintSnapshot): Promise<{
    closedCells: number;
    recentTicks: number;
    connectionState: string;
  }> {
    return this.page.evaluate((snap) => {
      const w = window as unknown as {
        __tapeStore?: {
          getState: () => {
            ingestSnapshot: (s: unknown) => void;
            setConnectionState: (s: string) => void;
            closedCells: unknown[];
            recentTicks: unknown[];
            connectionState: string;
          };
        };
      };
      const store = w.__tapeStore;
      if (store === undefined) {
        throw new Error(
          '__tapeStore not found — is the dev server running (NODE_ENV=development)?',
        );
      }
      const state = store.getState();
      state.setConnectionState('connected');
      state.ingestSnapshot(snap);
      const after = store.getState();
      return {
        closedCells: after.closedCells.length,
        recentTicks: after.recentTicks.length,
        connectionState: after.connectionState,
      };
    }, snapshot as unknown as Record<string, unknown>);
  }

  /** Wait until the dev `__tapeStore` hook is present on `window`. */
  async waitForStoreHook(): Promise<void> {
    await this.page.waitForFunction(
      () => '__tapeStore' in window,
      undefined,
      { timeout: 15_000 },
    );
  }

  /**
   * Wait until the client bundle has hydrated. The `__tapeStore` global
   * is published during client module eval (and never during SSR), so its
   * presence is a reliable "React is interactive now" signal — clicking
   * rail entries before this point hits SSR markup whose onClick handlers
   * are not yet attached, which silently no-ops.
   */
  async waitForHydrated(): Promise<void> {
    await this.waitForStoreHook();
  }

  /**
   * Switch to replay mode robustly. Waits for hydration, clicks the rail
   * entry, and confirms the mode actually flipped (re-clicking once if a
   * race swallowed the first click) before returning.
   */
  async enterReplay(): Promise<void> {
    await this.waitForHydrated();
    const replay = this.replayRailEntry();
    await replay.click();
    // Confirm the flip; if hydration raced the first click, retry once.
    if ((await replay.getAttribute('aria-pressed')) !== 'true') {
      await expect
        .poll(() => replay.getAttribute('aria-pressed'), { timeout: 3_000 })
        .toBe('true')
        .catch(async () => {
          await replay.click();
        });
    }
    await expect(replay).toHaveAttribute('aria-pressed', 'true');
  }

  /** Read a numeric/string field off the store's current state. */
  async storeField<T>(field: string): Promise<T> {
    return this.page.evaluate((key) => {
      const w = window as unknown as {
        __tapeStore?: { getState: () => Record<string, unknown> };
      };
      const store = w.__tapeStore;
      if (store === undefined) throw new Error('__tapeStore missing');
      return store.getState()[key] as T;
    }, field);
  }

  /* --------------------------- canvas paint ---------------------------- */

  /**
   * Sample the footprint canvas backing store and return the fraction of
   * sampled pixels that differ from the dominant (background) colour.
   * A blank canvas returns ~0; a painted footprint returns a clearly
   * non-zero fraction. We sample on a sparse grid to stay cheap.
   */
  async canvasPaintedFraction(): Promise<number> {
    return this.chartCanvas().evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return 0;
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return 0;
      const img = ctx.getImageData(0, 0, w, h).data;
      // Tally colours on a sparse grid; the modal colour is the
      // background. Anything else is painted content.
      const counts = new Map<string, number>();
      let sampled = 0;
      const step = 7; // prime-ish stride to avoid aliasing with the grid
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const r = img[i] ?? 0;
          const g = img[i + 1] ?? 0;
          const b = img[i + 2] ?? 0;
          const key = `${String(r)},${String(g)},${String(b)}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          sampled += 1;
        }
      }
      if (sampled === 0) return 0;
      let modal = 0;
      for (const c of counts.values()) modal = Math.max(modal, c);
      return (sampled - modal) / sampled;
    });
  }

  /**
   * Wait until the canvas has painted a non-trivial amount of content.
   * Polls the painted fraction; the footprint fills a meaningful slice
   * of the canvas, so even a conservative threshold is unambiguous.
   */
  async expectCanvasPainted(minFraction = 0.02): Promise<void> {
    await expect
      .poll(() => this.canvasPaintedFraction(), {
        timeout: 10_000,
        message: 'footprint canvas never painted injected cells',
      })
      .toBeGreaterThan(minFraction);
  }
}
