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

import { parseOklch } from './color';
import {
  normalizeClose,
  normalizeDelta,
  type NormalizedCell,
} from './cells';
import { paintAxes, type AxisPalette } from './painters/axes';
import { paintBackground } from './painters/background';
import { paintCells, type CellPalette } from './painters/cells';
import {
  paintCursor,
  type CursorCell,
  type CursorPalette,
  type CursorPx,
} from './painters/cursor';
import { paintGrid } from './painters/grid';
import { paintRightEdge, type StripPalette } from './painters/right-edge';
import {
  chartConfig,
  computeAxisXRegion,
  computeAxisYRegion,
  computeBarRegion,
  computeStripRegion,
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
  strip: StripPalette;
  cursor: CursorPalette;
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

  // Session extreme — tracked across the engine lifetime, NOT
  // persisted (consistent with `useStreamStore` ephemerality).
  #sessionMaxTrades = 0;

  // Wheel listener stored so we can remove on dispose.
  #onWheel: ((e: WheelEvent) => void) | null = null;

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

    // Auto-follow live: if `scrollX === 0` (settled) and a new tick
    // arrives, leave it at 0 — the new bar materialises at the right
    // edge automatically because `latestBucketTs` advanced.
    // If user has scrolled away (scrollX > 0), do NOT auto-snap.
    const followLiveVisible = this.#currentScrollX > 0;

    const barRegion = computeBarRegion(vp);
    const stripRegion = computeStripRegion(vp);
    const axisXRegion = computeAxisXRegion(vp);
    const axisYRegion = computeAxisYRegion(vp);

    const latestBucketTs = latestBucketTimestamp(state);
    const scale: ChartScale = {
      barRegion,
      latestBucketTs,
      barDurationMs: BAR_DURATION_MS,
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
    paintAxes(
      this.#ctx,
      barRegion,
      axisXRegion,
      axisYRegion,
      scale,
      this.#palette.axes,
      this.#dpr,
    );
    paintRightEdge(
      this.#ctx,
      stripRegion,
      state.recentTicks,
      this.#palette.strip,
      followLiveVisible,
    );

    // Cursor paint sits AFTER cells + tape strip and BEFORE axes —
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
    },
    axes: {
      tick: t['--color-axis-tick'],
      label: t['--color-axis-label'],
    },
    strip: {
      bid: t['--color-bid'],
      ask: t['--color-ask'],
      label: t['--color-axis-label'],
    },
    cursor: {
      line: t['--color-cell-cursor'],
      glow: t['--color-cell-cursor-glow'],
    },
  };
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
