/**
 * FootprintChartEngine — Canvas2D footprint chart, plain TypeScript
 * (no React, no JSX, no hooks). Browser-only.
 *
 * Architecture in three sentences:
 *
 *   1. The engine owns a canvas, a render loop, and a small pile of
 *      cached state (theme token snapshot, viewport, scroll target).
 *
 *   2. It subscribes ONCE to the theme bridge and to the stream store
 *      at construction. Every update flips `dirty = true`; the next
 *      `requestAnimationFrame` tick paints if dirty and only if dirty.
 *
 *   3. The painter pipeline is deterministic and split into modules
 *      (`paintBackground`, `paintGrid`, `paintCells`, `paintAxes`,
 *      `paintRightEdge`) so unit tests can exercise the scale + state
 *      math without rendering pixels.
 *
 * Frame budget per ADR-006:
 *   - Render skipped when nothing changed (the 60 fps under sustained
 *     tick rate budget).
 *   - Token snapshot cached + parsed once per `data-theme` flip, never
 *     per frame.
 *   - Cell fills batched by color — `fillStyle` switching is the
 *     dominant Canvas2D cost.
 *   - All DOM measurement happens on `handleResize` only, never on a
 *     paint pass.
 *
 * Dev-only `performance.now()` counter logs avg + p99 frame times to
 * the console behind `process.env.NODE_ENV === 'development'` so the
 * literal is DCE'd in production builds (same strip-at-build pattern
 * as Task 2.4's DevStatusPip).
 */
import { type StoreApi } from 'zustand';

import { formatOklch, parseOklch } from './color';
import {
  normalizeClose,
  normalizeDelta,
  type NormalizedCell,
} from './cells';
import { paintAxes, type AxisPalette } from './painters/axes';
import { paintBackground } from './painters/background';
import {
  paintBarDeltas,
  paintCells,
  type CellPalette,
} from './painters/cells';
import {
  paintCursor,
  type CursorCell,
  type CursorPalette,
  type CursorPx,
} from './painters/cursor';
import { paintCvd, type CvdPalette } from './painters/cvd';
import { paintGrid } from './painters/grid';
import {
  chartConfig,
  computeAxisXRegion,
  computeAxisYRegion,
  computeBarRegion,
  computeCvdRegion,
  fitCellWidth,
  scrollClampMax,
  xToBucketTs,
  yToPriceBucket,
  type ChartScale,
  type Viewport,
} from './scale';
import type {
  ThemeTokensSnapshot,
} from '@/lib/theme/tokens';
import type { StreamState } from '@/lib/stores/stream-store';

/* ============================================================== *\
   Defaults
\* ============================================================== */

/**
 * Price bucket size in USD for BTC-PERP — matches the synthesizer's $5
 * alignment.
 *
 * Exported so non-canvas consumers (e.g., `<CellTooltip />`) can recover
 * the USD price from a `priceBucket` INDEX without redefining the
 * constant. The unit convention across the chart pipeline is INDEX —
 * see the docblock on `ChartScale` in `scale.ts` — so any UI that
 * surfaces a `priceBucket` value to a human MUST multiply by this
 * factor first.
 */
export const DEFAULT_PRICE_BUCKET_SIZE = 5;

/** Bar duration in ms — 1-minute bars per ADR-005. */
const BAR_DURATION_MS = 60_000;

/** Smoothing factor for the scrollX critical-damped follow. */
const SCROLL_SMOOTHING = 0.2;

/** Distance under which we snap to target and stop marking dirty. */
const SCROLL_SETTLE_PX = 0.5;

/** Pixels per wheel notch for horizontal scrubbing. */
const WHEEL_SCROLL_GAIN = 1;

/** Dev FPS logger cadence — once per N frames. */
const DEV_FPS_LOG_FRAMES = 600;

/* ============================================================== *\
   Engine
\* ============================================================== */

export interface FootprintChartEngineDeps {
  /** Theme tokens bridge — subscribe once, cache snapshot per flip. */
  themeBridge: {
    current(): ThemeTokensSnapshot;
    subscribe(cb: (snap: ThemeTokensSnapshot) => void): () => void;
  };
  /** Stream store — subscribe once at construction. */
  streamStore: StoreApi<StreamState>;
  /** Whether the user prefers reduced motion. */
  prefersReducedMotion: boolean;
}

interface DerivedPalette {
  bg: string;
  grid: string;
  cells: CellPalette;
  axes: AxisPalette;
  cursor: CursorPalette;
  cvd: CvdPalette;
}

/**
 * Snapshot of the cursor state pushed to subscribers. `null` means the
 * pointer has left the canvas. When non-null, `cell` carries the
 * computed (bucketTs, priceBucket) tuple and the normalized cell data
 * if a recorded cell occupies that slot (otherwise `data: null`).
 */
export interface CursorSubscriberState {
  px: CursorPx;
  cell: CursorCell;
  data: NormalizedCell | null;
}

/** Snapshot pushed to scroll subscribers — used by the Follow-live pill. */
export interface ScrollSubscriberState {
  currentScrollX: number;
  targetScrollX: number;
  atRightEdge: boolean;
}

export class FootprintChartEngine {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #deps: FootprintChartEngineDeps;

  // Render state.
  #running = false;
  #dirty = true;
  #rafHandle: number | null = null;
  #viewport: Viewport = { x: 0, y: 0, w: 0, h: 0 };
  #dpr = 1;

  // Theme cache. Token strings + parsed OKLCH triples — parse cost
  // paid once per theme flip, never per frame.
  #tokens: ThemeTokensSnapshot;
  #palette: DerivedPalette;
  #unsubscribeTheme: (() => void) | null = null;

  // Stream cache. The engine reads via `getState()` on every paint
  // (which is cheap — Zustand getState is a property read) but only
  // paints when the store subscription notification has set `dirty`.
  #unsubscribeStore: (() => void) | null = null;

  // Scale state — derived from the stream + scroll target.
  #targetScrollX = 0;
  #currentScrollX = 0;
  #priceMid: number | null = null;
  // P0-1 fit-to-data bar-column width. Recomputed each paint while the
  // user is pinned to the live right edge; frozen while scrolled into
  // history so panning does not re-stretch the columns. Seeds to the
  // static default so the first paint (before any data) is sensible.
  #fittedCellWidth: number = chartConfig.cellWidth;

  // Session extreme — tracked across the engine lifetime, NOT
  // persisted (consistent with `useStreamStore` ephemerality).
  #sessionMaxTrades = 0;

  // Wheel listener stored so we can remove on dispose.
  #onWheel: ((e: WheelEvent) => void) | null = null;

  // ----- CVD sub-pane (Task 3.2c). -----
  // A second, OPTIONAL canvas painted in the SAME rAF pass with the
  // SAME scale as the footprint so the X-axes stay locked. Null until
  // the React shell calls `attachCvdCanvas`; the engine paints the CVD
  // pane only when both the canvas and a non-zero viewport are present.
  #cvdCanvas: HTMLCanvasElement | null = null;
  #cvdCtx: CanvasRenderingContext2D | null = null;
  #cvdViewport: Viewport = { x: 0, y: 0, w: 0, h: 0 };
  #cvdDpr = 1;

  // Cursor state. `cursorPx` is the raw pointer coords in CSS pixels;
  // `cursorCell` is recomputed only when `cursorPx` changes (NOT every
  // paint pass — the inverse scale read is cheap but the React
  // tooltip's subscriber should not fire on no-op pointer moves).
  #cursorPx: CursorPx | null = null;
  #cursorCell: CursorCell | null = null;

  // Subscriber sets — separate channels for cursor and scroll so
  // consumers do not pay for notifications they did not ask for. Kept
  // distinct from the engine's internal theme + store subscriptions
  // per the subscribe-once contract documented in AGENT_NOTES.
  readonly #cursorSubscribers = new Set<
    (s: CursorSubscriberState | null) => void
  >();
  readonly #scrollSubscribers = new Set<
    (s: ScrollSubscriberState) => void
  >();
  // Tracks the last broadcast scroll snapshot so we notify only on
  // actual state change (not on every rAF tick).
  #lastScrollNotification: ScrollSubscriberState | null = null;

  // Dev-only frame timing.
  #frameTimings: number[] = [];
  #frameCount = 0;

  constructor(canvas: HTMLCanvasElement, deps: FootprintChartEngineDeps) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) {
      throw new Error(
        'FootprintChartEngine: failed to get 2D context. The canvas must ' +
          'be attached to the DOM before constructing the engine.',
      );
    }
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#deps = deps;
    this.#tokens = deps.themeBridge.current();
    this.#palette = derivePalette(this.#tokens);
  }

  /* -------------------------------------------------------------- *\
     Lifecycle
  \* -------------------------------------------------------------- */

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#dirty = true;

    // Subscribe ONCE to the theme bridge.
    this.#unsubscribeTheme = this.#deps.themeBridge.subscribe((snap) => {
      this.#tokens = snap;
      this.#palette = derivePalette(snap);
      this.#dirty = true;
    });

    // Subscribe ONCE to the stream store. Every notification flips
    // `dirty`; the rAF loop decides whether to actually paint.
    this.#unsubscribeStore = this.#deps.streamStore.subscribe(() => {
      this.#dirty = true;
    });

    // Wheel listener — direct-bind on the canvas to avoid passive
    // page-scroll interference.
    this.#onWheel = (event) => {
      // Convert vertical wheel (trader-UI convention) to horizontal
      // scroll. Shift+wheel inverts the sign. Touchpad horizontal
      // (deltaX) also maps to scroll directly.
      const delta =
        event.shiftKey || event.deltaX !== 0
          ? event.deltaX !== 0
            ? event.deltaX
            : -event.deltaY
          : event.deltaY;
      this.#scrollBy(delta * WHEEL_SCROLL_GAIN);
      event.preventDefault();
    };
    this.#canvas.addEventListener('wheel', this.#onWheel, { passive: false });

    this.#schedule();
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#rafHandle !== null) {
      cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }
    if (this.#unsubscribeTheme !== null) {
      this.#unsubscribeTheme();
      this.#unsubscribeTheme = null;
    }
    if (this.#unsubscribeStore !== null) {
      this.#unsubscribeStore();
      this.#unsubscribeStore = null;
    }
    if (this.#onWheel !== null) {
      this.#canvas.removeEventListener('wheel', this.#onWheel);
      this.#onWheel = null;
    }
    // Drop subscriber references — the React shell unmounts before
    // we get here and tooltips / Follow-live pills will re-subscribe
    // on the next engine instance.
    this.#cursorSubscribers.clear();
    this.#scrollSubscribers.clear();
    this.#lastScrollNotification = null;
    // Release the CVD pane canvas — the React shell re-attaches on the
    // next engine instance.
    this.detachCvdCanvas();
  }

  /**
   * Sync the canvas backing-store to its CSS size for the given DPR.
   * Called from the React shell's `ResizeObserver`. We do NOT touch
   * `canvas.width` / `canvas.height` on the hot path.
   */
  handleResize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.#dpr = dpr;
    // canvas.width/height are device pixels; canvas style.width/height
    // (set by the React shell via flex sizing) are CSS pixels.
    this.#canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.#canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.#ctx.setTransform(1, 0, 0, 1, 0, 0); // reset accumulated scales
    this.#ctx.scale(dpr, dpr);
    this.#viewport = { x: 0, y: 0, w: cssWidth, h: cssHeight };
    this.#dirty = true;
  }

  /* -------------------------------------------------------------- *\
     CVD sub-pane API (Task 3.2c)
  \* -------------------------------------------------------------- */

  /**
   * Attach the CVD sub-pane canvas. The engine paints it in the same
   * rAF pass as the footprint using the same scale, so the X-axes are
   * locked together. Idempotent — re-attaching the same canvas is a
   * no-op. Flips dirty so the next tick paints the pane.
   */
  attachCvdCanvas(canvas: HTMLCanvasElement): void {
    if (this.#cvdCanvas === canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) {
      throw new Error(
        'FootprintChartEngine.attachCvdCanvas: failed to get 2D context.',
      );
    }
    this.#cvdCanvas = canvas;
    this.#cvdCtx = ctx;
    this.#dirty = true;
  }

  /**
   * Detach the CVD sub-pane canvas (React shell unmount of the pane).
   * The footprint keeps running; only the CVD paint stops.
   */
  detachCvdCanvas(): void {
    this.#cvdCanvas = null;
    this.#cvdCtx = null;
    this.#cvdViewport = { x: 0, y: 0, w: 0, h: 0 };
  }

  /**
   * Sync the CVD canvas backing store to its CSS size. Mirrors
   * `handleResize` for the sub-pane. The CVD canvas width MUST match
   * the footprint canvas width for the shared X-axis to line up — the
   * React shell stacks the two in the same flex column to guarantee
   * this.
   */
  handleCvdResize(cssWidth: number, cssHeight: number, dpr: number): void {
    if (this.#cvdCanvas === null) return;
    this.#cvdDpr = dpr;
    this.#cvdCanvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.#cvdCanvas.height = Math.max(1, Math.round(cssHeight * dpr));
    const ctx = this.#cvdCtx;
    if (ctx !== null) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    this.#cvdViewport = { x: 0, y: 0, w: cssWidth, h: cssHeight };
    this.#dirty = true;
  }

  /* -------------------------------------------------------------- *\
     Cursor + scroll subscriber API (Phase 3.2)
  \* -------------------------------------------------------------- */

  /**
   * Set the cursor pixel coordinates (CSS pixels, relative to the
   * canvas). The container component is expected to throttle calls to
   * one per rAF tick — the engine itself does NOT debounce, because
   * the cell-recompute is cheap and we want every coalesced position
   * to land before the next paint.
   *
   * No-op when the new coords equal the current ones (saves a render
   * + a subscriber notify on jitter-free pointer events).
   */
  setCursor(px: CursorPx): void {
    if (
      this.#cursorPx !== null &&
      this.#cursorPx.x === px.x &&
      this.#cursorPx.y === px.y
    ) {
      return;
    }
    this.#cursorPx = px;
    this.#recomputeCursorCell();
    this.#dirty = true;
    this.#notifyCursorSubscribers();
  }

  /**
   * Clear the cursor — pointer left the canvas. Flips the engine
   * dirty so the crosshair erases on the next paint.
   */
  clearCursor(): void {
    if (this.#cursorPx === null) return;
    this.#cursorPx = null;
    this.#cursorCell = null;
    this.#dirty = true;
    this.#notifyCursorSubscribers();
  }

  /**
   * Subscribe to cursor state changes. The callback fires synchronously
   * with the current snapshot on subscribe (so the tooltip can hydrate
   * its first paint without waiting for a pointer move), then on every
   * `setCursor` / `clearCursor` call.
   *
   * Returns an unsubscribe function.
   */
  subscribeCursor(
    cb: (state: CursorSubscriberState | null) => void,
  ): () => void {
    this.#cursorSubscribers.add(cb);
    cb(this.#buildCursorState());
    return () => {
      this.#cursorSubscribers.delete(cb);
    };
  }

  /**
   * Subscribe to scroll state changes. Same contract as
   * `subscribeCursor`: callback fires once on subscribe with the
   * current snapshot, then only when the snapshot actually changes
   * (NOT every rAF tick).
   */
  subscribeScroll(cb: (state: ScrollSubscriberState) => void): () => void {
    this.#scrollSubscribers.add(cb);
    cb(this.#buildScrollState());
    return () => {
      this.#scrollSubscribers.delete(cb);
    };
  }

  /**
   * Imperatively set the scroll target — used by the Follow-live pill
   * to snap back to 0. The existing smoothing animates the journey;
   * `prefers-reduced-motion` collapses to an instant jump per the same
   * rule as `#advanceScroll`.
   */
  setScrollTarget(targetX: number): void {
    const next = targetX < 0 ? 0 : targetX;
    if (this.#targetScrollX === next) return;
    this.#targetScrollX = next;
    this.#dirty = true;
  }

  /* -------------------------------------------------------------- *\
     Render loop
  \* -------------------------------------------------------------- */

  #schedule(): void {
    if (!this.#running) return;
    this.#rafHandle = requestAnimationFrame(() => {
      this.#rafHandle = null;
      this.#tick();
      this.#schedule();
    });
  }

  #tick(): void {
    // Advance scroll smoothing. If we're far from the target we keep
    // `dirty` true so the next frame paints; once we settle within
    // SCROLL_SETTLE_PX, snap and let `dirty` decide normally.
    this.#advanceScroll();

    if (!this.#dirty) return;

    const t0 =
      process.env.NODE_ENV === 'development' ? performance.now() : 0;

    this.#paint();
    this.#dirty = false;

    if (process.env.NODE_ENV === 'development') {
      const dt = performance.now() - t0;
      this.#frameTimings.push(dt);
      this.#frameCount += 1;
      if (this.#frameTimings.length > 240) this.#frameTimings.shift();
      if (this.#frameCount % DEV_FPS_LOG_FRAMES === 0) {
        const avg =
          this.#frameTimings.reduce((s, v) => s + v, 0) /
          this.#frameTimings.length;
        const sorted = [...this.#frameTimings].sort((a, b) => a - b);
        const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? avg;
        console.log(
          `[footprint] avg=${avg.toFixed(2)}ms p99=${p99.toFixed(2)}ms ` +
            `frames=${this.#frameCount}`,
        );
      }
    }
  }

  #advanceScroll(): void {
    const delta = this.#targetScrollX - this.#currentScrollX;
    if (Math.abs(delta) < SCROLL_SETTLE_PX) {
      if (this.#currentScrollX !== this.#targetScrollX) {
        this.#currentScrollX = this.#targetScrollX;
        this.#dirty = true;
      }
      return;
    }
    if (this.#deps.prefersReducedMotion) {
      // No interpolation — jump.
      this.#currentScrollX = this.#targetScrollX;
    } else {
      this.#currentScrollX += delta * SCROLL_SMOOTHING;
    }
    this.#dirty = true;
  }

  /* -------------------------------------------------------------- *\
     Paint pass
  \* -------------------------------------------------------------- */

  #paint(): void {
    const vp = this.#viewport;
    if (vp.w <= 0 || vp.h <= 0) return;

    const state = this.#deps.streamStore.getState();
    const cells = collectCells(state);
    this.#updateSessionExtreme(cells);
    this.#updatePriceMid(state, cells);

    const barRegion = computeBarRegion(vp);
    const axisXRegion = computeAxisXRegion(vp);
    const axisYRegion = computeAxisYRegion(vp);

    // P0-1 fit-to-data: size the bar columns so the available bars span
    // the bar region instead of smearing into a thin right-edge sliver.
    // `availableBars` is the distinct bar count the store can show
    // (closed bars + the live open bar). The fit helper clamps the
    // result to a legible band — at high bar counts it pins to the
    // default width and lets the user scroll. We only fit while the user
    // is pinned to the live right edge; once they scroll into history we
    // freeze the width so panning does not re-stretch every column.
    const availableBars = distinctBarCount(state);
    if (this.#currentScrollX === 0 && this.#targetScrollX === 0) {
      this.#fittedCellWidth = fitCellWidth(barRegion.w, availableBars);
    }

    const latestBucketTs = latestBucketTimestamp(state);
    const scale: ChartScale = {
      barRegion,
      latestBucketTs,
      barDurationMs: BAR_DURATION_MS,
      cellWidth: this.#fittedCellWidth,
      priceMid: this.#priceMid ?? 0,
      priceBucketSize: DEFAULT_PRICE_BUCKET_SIZE,
      scrollX: this.#currentScrollX,
    };

    // Clamp scroll target to history bounds.
    const historyBars = Math.max(1, state.closedCells.length + 1);
    const maxScroll = scrollClampMax(scale, historyBars);
    if (this.#targetScrollX > maxScroll) {
      this.#targetScrollX = maxScroll;
      this.#currentScrollX = Math.min(this.#currentScrollX, maxScroll);
    }
    if (this.#targetScrollX < 0) {
      this.#targetScrollX = 0;
      this.#currentScrollX = Math.max(this.#currentScrollX, 0);
    }

    paintBackground(this.#ctx, vp, this.#palette.bg);
    paintGrid(this.#ctx, barRegion, scale, this.#palette.grid, this.#dpr);
    paintCells(
      this.#ctx,
      barRegion,
      scale,
      cells,
      this.#sessionMaxTrades,
      this.#palette.cells,
      this.#dpr,
    );
    // Per-bar delta foot numbers (P0-2) — one signed, colour-coded label
    // per bar column at the foot of the bar region.
    paintBarDeltas(this.#ctx, barRegion, scale, cells, this.#palette.cells);
    paintAxes(
      this.#ctx,
      barRegion,
      axisXRegion,
      axisYRegion,
      scale,
      this.#palette.axes,
      this.#dpr,
    );

    // Cursor paint sits AFTER cells and BEFORE axes —
    // crosshair over cells, axis labels over crosshair. The painter
    // is a no-op when `cursorPx` is null.
    if (this.#cursorPx !== null) {
      // Keep `cursorCell` consistent with the live scale (the scale's
      // `latestBucketTs` and `priceMid` may have changed since the
      // last pointer move). Recompute without touching the cursorPx
      // — no subscriber notification needed when only the underlying
      // scale shifted.
      this.#cursorCell = this.#computeCursorCell(this.#cursorPx, scale);
    }
    paintCursor(
      this.#ctx,
      barRegion,
      scale,
      this.#cursorPx,
      this.#cursorCell,
      this.#palette.cursor,
      this.#dpr,
    );

    // Broadcast scroll changes to subscribers — only when the state
    // actually changed. atRightEdge is the live-follow signal the
    // Follow-live pill subscribes to.
    this.#notifyScrollSubscribers();

    // CVD sub-pane (Task 3.2c). Painted in the SAME pass, with the
    // SAME `scale` — the CVD region's X bounds equal the bar region's
    // (same padding / strip / axis reservation), so `bucketTsToX` maps
    // a bar to the identical X column in both panes. The pane reads the
    // client-derived `cvdSeries` (ADR-008 seam) — it never re-folds the
    // cell stream.
    this.#paintCvd(scale, state);
  }

  /**
   * Paint the CVD sub-pane onto its own canvas. No-op when the pane is
   * not attached or has no measured size. Uses the footprint's `scale`
   * so the X-axis is locked to the chart above.
   */
  #paintCvd(scale: ChartScale, state: StreamState): void {
    const ctx = this.#cvdCtx;
    const cvp = this.#cvdViewport;
    if (ctx === null || cvp.w <= 0 || cvp.h <= 0) return;

    // Wipe the pane to the chart background each frame.
    paintBackground(ctx, cvp, this.#palette.bg);

    const region = computeCvdRegion(cvp);
    paintCvd(
      ctx,
      region,
      scale,
      state.cvdSeries,
      this.#palette.cvd,
      this.#cvdDpr,
      formatCvdValue,
    );
  }

  /* -------------------------------------------------------------- *\
     Cursor helpers (Phase 3.2)
  \* -------------------------------------------------------------- */

  /**
   * Translate the current pointer pixel coords into a (bucketTs,
   * priceBucket) tuple via the existing scale inverses. Uses a
   * lightweight scale built from the most recent paint-time state so
   * the cursor cell is meaningful before the first paint after a
   * pointer move (the React shell may invoke `setCursor` between two
   * rAF ticks).
   */
  #recomputeCursorCell(): void {
    if (this.#cursorPx === null) {
      this.#cursorCell = null;
      return;
    }
    const scale = this.#buildLightweightScale();
    this.#cursorCell = this.#computeCursorCell(this.#cursorPx, scale);
  }

  #computeCursorCell(px: CursorPx, scale: ChartScale): CursorCell {
    return {
      bucketTs: xToBucketTs(scale, px.x),
      priceBucket: yToPriceBucket(scale, px.y),
    };
  }

  /**
   * Build a `ChartScale` from current engine state. Used for
   * subscriber notifications between paints — the paint pass builds
   * its own scale via the same inputs, so this is consistent.
   */
  #buildLightweightScale(): ChartScale {
    const vp = this.#viewport;
    const barRegion = computeBarRegion(vp);
    const state = this.#deps.streamStore.getState();
    return {
      barRegion,
      latestBucketTs: latestBucketTimestamp(state),
      barDurationMs: BAR_DURATION_MS,
      cellWidth: this.#fittedCellWidth,
      priceMid: this.#priceMid ?? 0,
      priceBucketSize: DEFAULT_PRICE_BUCKET_SIZE,
      scrollX: this.#currentScrollX,
    };
  }

  #buildCursorState(): CursorSubscriberState | null {
    if (this.#cursorPx === null || this.#cursorCell === null) return null;
    const data = this.#findCellData(this.#cursorCell);
    return {
      px: this.#cursorPx,
      cell: this.#cursorCell,
      data,
    };
  }

  /** Locate the normalized cell at `cell` in the current store state,
   * or null if no cell occupies that slot. */
  #findCellData(cell: CursorCell): NormalizedCell | null {
    const state = this.#deps.streamStore.getState();
    // Open cells first — bucketTs likely matches the live bar.
    for (const open of state.openCells.values()) {
      if (
        open.bucketTs === cell.bucketTs &&
        open.priceBucket === cell.priceBucket
      ) {
        return normalizeDelta(open);
      }
    }
    // Then closed cells (linear walk — bounded at STREAM_CLOSED_CELLS_CAP
    // = 120 per ADR-006, fast enough to do per-cursor-move).
    for (const closed of state.closedCells) {
      if (
        closed.bucketTs === cell.bucketTs &&
        closed.priceBucket === cell.priceBucket
      ) {
        return normalizeClose(closed);
      }
    }
    return null;
  }

  #notifyCursorSubscribers(): void {
    if (this.#cursorSubscribers.size === 0) return;
    const snap = this.#buildCursorState();
    for (const cb of this.#cursorSubscribers) {
      cb(snap);
    }
  }

  #buildScrollState(): ScrollSubscriberState {
    return {
      currentScrollX: this.#currentScrollX,
      targetScrollX: this.#targetScrollX,
      atRightEdge: this.#currentScrollX === 0 && this.#targetScrollX === 0,
    };
  }

  #notifyScrollSubscribers(): void {
    if (this.#scrollSubscribers.size === 0) return;
    const next = this.#buildScrollState();
    const prev = this.#lastScrollNotification;
    if (
      prev !== null &&
      prev.currentScrollX === next.currentScrollX &&
      prev.targetScrollX === next.targetScrollX &&
      prev.atRightEdge === next.atRightEdge
    ) {
      return;
    }
    this.#lastScrollNotification = next;
    for (const cb of this.#scrollSubscribers) {
      cb(next);
    }
  }

  /* -------------------------------------------------------------- *\
     State derivation helpers
  \* -------------------------------------------------------------- */

  #updateSessionExtreme(cells: NormalizedCell[]): void {
    for (const c of cells) {
      if (c.trades > this.#sessionMaxTrades) {
        this.#sessionMaxTrades = c.trades;
      }
    }
  }

  #updatePriceMid(state: StreamState, cells: NormalizedCell[]): void {
    // Anchor the visible Y range to the most recent tick on first sight,
    // then ride along the latest tick — but only when the user has not
    // scrolled. (Scroll-pan vertical price range is a Phase 3.4 zoom
    // concern.)
    // priceMid is in `priceBucket` INDEX units (one step = one row,
    // matches the renderer's INDEX convention end-to-end — see
    // scale.ts ChartScale docblock). Raw USD price divides by the
    // bucket size to get the bucket index.
    if (this.#priceMid === null) {
      if (state.recentTicks.length > 0) {
        const lastTick = state.recentTicks[state.recentTicks.length - 1]!;
        this.#priceMid = Math.round(lastTick.price / DEFAULT_PRICE_BUCKET_SIZE);
      } else if (cells.length > 0) {
        // Median price bucket of the visible cells.
        const buckets = cells.map((c) => c.priceBucket).sort((a, b) => a - b);
        this.#priceMid = buckets[Math.floor(buckets.length / 2)] ?? null;
      }
      return;
    }
    // Anchored — re-centre only on a large drift. Threshold compared in
    // bucket-index units (halfRows is already a row count).
    const vp = this.#viewport;
    const halfRows =
      Math.floor(computeBarRegion(vp).h / chartConfig.cellHeight / 2) || 1;
    if (state.recentTicks.length === 0) return;
    const lastPrice =
      state.recentTicks[state.recentTicks.length - 1]!.price;
    const lastBucket = Math.round(lastPrice / DEFAULT_PRICE_BUCKET_SIZE);
    const drift = Math.abs(lastBucket - this.#priceMid);
    if (drift > halfRows) {
      this.#priceMid = lastBucket;
    }
  }

  /* -------------------------------------------------------------- *\
     Scroll input
  \* -------------------------------------------------------------- */

  #scrollBy(dx: number): void {
    this.#targetScrollX += dx;
    if (this.#targetScrollX < 0) this.#targetScrollX = 0;
    this.#dirty = true;
  }

  /* -------------------------------------------------------------- *\
     Test-only accessors. Not part of the production surface.
  \* -------------------------------------------------------------- */

  /** @internal */
  _testGetState() {
    return {
      sessionMaxTrades: this.#sessionMaxTrades,
      targetScrollX: this.#targetScrollX,
      currentScrollX: this.#currentScrollX,
      dirty: this.#dirty,
      priceMid: this.#priceMid,
      cursorPx: this.#cursorPx,
      cursorCell: this.#cursorCell,
      cursorSubscriberCount: this.#cursorSubscribers.size,
      scrollSubscriberCount: this.#scrollSubscribers.size,
      cvdCanvasAttached: this.#cvdCanvas !== null,
      cvdViewport: this.#cvdViewport,
    };
  }

  /** @internal */
  _testNotifyStoreChange(): void {
    this.#dirty = true;
  }

  /** @internal */
  _testTick(): void {
    this.#tick();
  }

  /** @internal */
  _testScrollBy(dx: number): void {
    this.#scrollBy(dx);
  }
}

/* ============================================================== *\
   Helpers
\* ============================================================== */

function derivePalette(t: ThemeTokensSnapshot): DerivedPalette {
  const fontMono = t['--font-mono'];
  return {
    bg: t['--color-bg'],
    grid: t['--color-grid'],
    cells: {
      cellBg: parseOklch(t['--color-cell-bg']),
      cellBgStrong: parseOklch(t['--color-cell-bg-strong']),
      cellFg: t['--color-cell-fg'],
      cellFgSubtle: t['--color-cell-fg-subtle'],
      cellStroke: t['--color-cell-stroke'],
      imbalanceBuy: parseOklch(t['--color-cell-imbalance-buy']),
      imbalanceSell: parseOklch(t['--color-cell-imbalance-sell']),
      imbalanceNeutral: parseOklch(t['--color-cell-imbalance-neutral']),
      bid: t['--color-bid'],
      ask: t['--color-ask'],
      deltaUp: t['--color-delta-up'],
      deltaDown: t['--color-delta-down'],
      // Opaque backdrop for the per-bar delta foot band (P0-2) — the
      // chart background so the delta numbers read over any cells that
      // reach the bottom row.
      footBand: t['--color-bg'],
      fontMono,
    },
    axes: {
      tick: t['--color-axis-tick'],
      label: t['--color-axis-label'],
      fontMono,
    },
    cursor: {
      line: t['--color-cell-cursor'],
      glow: t['--color-cell-cursor-glow'],
    },
    cvd: {
      fontMono,
      // Slope-coded line: net buying rises (delta-up green), net
      // selling falls (delta-down red), flat is the neutral imbalance
      // tone. Reuses the existing footprint tokens so the CVD pane
      // theme-flips through the same getComputedStyle bridge — no new
      // tokens introduced (Task 3.2c: read sovereign tokens, do not
      // invent).
      up: t['--color-delta-up'],
      down: t['--color-delta-down'],
      neutral: t['--color-cell-imbalance-neutral'],
      baseline: t['--color-grid'],
      label: t['--color-axis-label'],
      // Low-alpha area fill (P1-4): a translucent version of the
      // cursor-accent hue so the swing silhouette reads without fighting
      // the slope-coded line on top.
      fill: formatOklch({ ...parseOklch(t['--color-cell-cursor']), alpha: 0.1 }),
    },
  };
}

/**
 * Format a CVD value for the in-pane numeric label. Signed, with a
 * compact `K` suffix above 10 000 so the label stays narrow at high
 * cumulative volumes. BTC perp CVD is in base-asset (BTC) units, so we
 * keep one decimal below 100 for legibility on quiet sessions.
 */
function formatCvdValue(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 10_000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  if (abs >= 100) return `${sign}${Math.round(abs).toString()}`;
  return `${sign}${abs.toFixed(1)}`;
}

function collectCells(state: StreamState): NormalizedCell[] {
  const out: NormalizedCell[] = [];
  for (const closed of state.closedCells) {
    out.push(normalizeClose(closed));
  }
  for (const open of state.openCells.values()) {
    out.push(normalizeDelta(open));
  }
  return out;
}

/**
 * Count of DISTINCT bar columns the store can currently show — closed
 * bars plus the live open bar. Drives the P0-1 fit-to-data width so the
 * available bars span the bar region. `closedCells` holds one row per
 * (bucketTs, priceBucket), so distinct bucketTs values are the real bar
 * count; `openCells` shares a single live bucketTs.
 *
 * Falls back to a sensible minimum so a near-empty store still fits to a
 * reasonable window rather than ballooning one bar across the pane while
 * the first minute of data accrues.
 */
const FIT_MIN_BARS = 14;

function distinctBarCount(state: StreamState): number {
  const buckets = new Set<number>();
  for (const c of state.closedCells) buckets.add(c.bucketTs);
  for (const o of state.openCells.values()) buckets.add(o.bucketTs);
  return Math.max(FIT_MIN_BARS, buckets.size);
}

function latestBucketTimestamp(state: StreamState): number {
  // The most authoritative live boundary is the last tick's wall
  // clock bucketed to the bar grid. Falls back to the most recent
  // closed bucket, then to the current wall-clock bar if neither is
  // present — so even an empty store paints a sensible (empty) right
  // edge.
  if (state.recentTicks.length > 0) {
    const t = state.recentTicks[state.recentTicks.length - 1]!.tsMs;
    return t - (t % BAR_DURATION_MS);
  }
  if (state.closedCells.length > 0) {
    // Closed cells' bucketTs is already aligned by construction.
    return state.closedCells[state.closedCells.length - 1]!.bucketTs;
  }
  const now = Date.now();
  return now - (now % BAR_DURATION_MS);
}

// Re-exports for engine consumers / tests.
export {
  bucketTsToX,
  priceToY,
  scrollClampMax,
  xToBucketTs,
  yToPriceBucket,
  chartConfig as chartLayout,
  type ChartScale,
} from './scale';
export type { NormalizedCell } from './cells';
