/**
 * BoardEngine — the meld canvas surface, plain TypeScript (no React,
 * no JSX, no hooks). Browser-only.
 *
 * ADR-008 in three sentences:
 *
 *   1. Two Canvas2D layers — a shape canvas (`<canvas data-meld-layer="shapes">`)
 *      for the document and a cursor canvas (`<canvas data-meld-layer="cursors">`)
 *      stacked above it, with `pointer-events: none` on the cursor
 *      layer so the shape canvas keeps hit-testing.
 *
 *   2. Subscribe ONCE at construct to (a) the root `Y.Map<shapeId, Y.Map>`
 *      observer, (b) the `Awareness` change event, and (c) the theme
 *      bridge. Each subscription flips its OWN dirty flag (shape vs
 *      cursor); multiple fires inside one frame collapse to ONE paint
 *      call on the next rAF tick. Theme flips dirty BOTH flags.
 *
 *   3. A single rAF loop dispatches to two paint paths — shape paint
 *      reads `shapeDirty` + repaints the shape canvas; cursor paint
 *      reads `cursorDirty` + repaints the cursor canvas. Per ADR-008
 *      this is a "one loop, two canvases" implementation — one rAF
 *      callback paints whichever canvas is dirty.
 *
 * Phase 3.3 — presence cursors:
 *
 *   The engine maintains a `Map<clientId, CursorState>` of per-peer
 *   render state. On every awareness `'change'` it syncs the map from
 *   `awareness.getStates()`:
 *
 *     - new peers spawn a fresh CursorState with `currentX/Y` snapped
 *       to `targetX/Y` (so the first paint puts them at their actual
 *       position, not at origin),
 *     - existing peers update `targetX/Y`,
 *     - peers whose `cursor` field went to `null` enter the off-canvas
 *       fade-out ramp (opacity 1 → 0 over 200 ms; entry removed when
 *       opacity reaches 0),
 *     - peers whose `cursor` field came back ramp opacity 0 → 1 over
 *       200 ms (a peer who left and re-entered fades back in at the
 *       new position).
 *
 *   On every rAF tick the cursor map's `currentX/Y` lerps toward
 *   `targetX/Y` via a critical-damped formula:
 *
 *     currentX += (targetX - currentX) * (1 - exp(-dt / tau))
 *
 *   with `tau = 30 ms` calibrated so the lerp lands within 0.5 px of
 *   the target at ~120 ms (4 × tau). The cursor dirty flag stays true
 *   while ANY peer is still in motion OR fading; once every peer has
 *   settled within 0.5 px AND no opacity ramp is active, the cursor
 *   loop idles.
 *
 *   Local-cursor skip — the engine excludes the local session id from
 *   the render map BEFORE the painter sees it; the OS pointer already
 *   renders it.
 *
 * Frame budget per ADR-008:
 *   - Paint skipped when nothing changed (the dirty gate).
 *   - Token snapshot cached + parsed once per `data-theme` flip,
 *     never per frame.
 *   - Cursor motion at ~16 ms cadence does NOT trigger shape repaint
 *     (independent dirty flags).
 *   - All DOM measurement happens on `handleResize` only, never on a
 *     paint pass.
 *
 * Dev-only `performance.now()` counter logs avg + p99 frame times to
 * the console every 240 frames behind `process.env.NODE_ENV ===
 * 'development'` so the literal is DCE'd in production builds (same
 * strip-at-build pattern tape's Task 2.4 + the meld conflict-viz
 * overlay use).
 */

import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

import { colorSlotFor } from '@/lib/identity/fnv1a';
import {
  parseAwarenessCursor,
  parseAwarenessIdentity,
} from '@/lib/yjs/awareness-schemas';

import { paintBackground } from './painters/background';
import {
  paintCursors,
  type CursorRenderState,
  type CursorsPalette,
} from './painters/cursors';
import { paintGrid } from './painters/grid';
import { paintShapes, type ShapesPalette } from './painters/shapes';
import type { ThemeTokensSnapshot } from './theme-tokens';
import type { Viewport } from './viewport';

/** Dev FPS logger cadence — once per N frames (~4 s at 60 fps). */
const DEV_FPS_LOG_FRAMES = 240;

/** Dev presence-cursor logger cadence — once per N cursor rAF ticks. */
const DEV_PRESENCE_LOG_FRAMES = 60;

/**
 * The shape engine's root Y.Map key. Hocuspocus documents share their
 * root maps by key; `'shapes'` is the canonical board document root
 * for meld.
 */
export const SHAPES_MAP_KEY = 'shapes';

/**
 * Critical-damped lerp time constant. The visible-snap convergence
 * window is ~4 × tau, so `tau = 30 ms` ⇒ ~120 ms perceptual settle
 * time, matching Figma's cursor feel per ADR-009.
 */
const CURSOR_LERP_TAU_MS = 30;

/** Opacity ramp duration on off-canvas fade-out / re-entry fade-in. */
const CURSOR_OPACITY_RAMP_MS = 200;

/**
 * Convergence threshold. The cursor's lerp is asymptotic — without a
 * "close enough" cutoff the cursorDirty flag would stay true forever
 * at floating-point epsilon. 0.5 CSS px is below visible motion on a
 * typical desktop (the OS pointer hot-spot tolerance is 1+ px).
 */
const CURSOR_SETTLED_THRESHOLD_PX = 0.5;

/* ============================================================== *\
   Palette derivation
\* ============================================================== */

interface DerivedPalette {
  bg: string;
  grid: string;
  shapes: ShapesPalette;
  cursors: CursorsPalette;
}

function derivePalette(t: ThemeTokensSnapshot): DerivedPalette {
  // The 8-slot awareness wheel is shared by both the shape painter
  // (which resolves each shape's `colorSlot` field) and the cursor
  // painter (which resolves each remote awareness state's
  // `colorSlot`). One tuple, two consumers — read once per theme
  // flip via the theme bridge cache, never per frame.
  const awarenessSlots = [
    t['--color-awareness-0'],
    t['--color-awareness-1'],
    t['--color-awareness-2'],
    t['--color-awareness-3'],
    t['--color-awareness-4'],
    t['--color-awareness-5'],
    t['--color-awareness-6'],
    t['--color-awareness-7'],
  ] as const;
  return {
    bg: t['--color-bg'],
    grid: t['--color-border'],
    shapes: {
      fg: t['--color-fg'],
      accent: t['--color-accent'],
      awarenessSlots,
    },
    cursors: {
      fg: t['--color-fg'],
      surface: t['--color-surface'],
      awarenessSlots,
    },
  };
}

/* ============================================================== *\
   Cursor render state
\* ============================================================== */

interface CursorState {
  clientId: number;
  sessionId: string;
  emojiChar: string;
  emojiName: string;
  colorSlot: number;
  // Target position (latest awareness value). null = peer cursor is
  // off-canvas (the peer reported `cursor: null`). The engine reads
  // `target* === null` as the fade-out trigger and stops moving
  // `currentX/Y`.
  targetX: number | null;
  targetY: number | null;
  // Interpolated position. Updated by the lerp loop every rAF tick.
  currentX: number;
  currentY: number;
  // Opacity ramp state. `opacity` is the painter input; `opacityTarget`
  // is what the ramp is heading toward (1 for on-canvas, 0 for fading
  // out). When `opacity === opacityTarget` the ramp is idle.
  opacity: number;
  opacityTarget: number;
  lastTickMs: number;
}

/* ============================================================== *\
   Metrics
\* ============================================================== */

interface LayerMetrics {
  paintCount: number;
  paintCostSumMs: number;
  framesSkipped: number;
  rolling: number[];
}

function emptyLayerMetrics(): LayerMetrics {
  return {
    paintCount: 0,
    paintCostSumMs: 0,
    framesSkipped: 0,
    rolling: [],
  };
}

export interface EngineMetrics {
  shape: {
    paintCount: number;
    avgPaintMs: number;
    p99PaintMs: number;
    framesSkipped: number;
  };
  cursor: {
    paintCount: number;
    avgPaintMs: number;
    p99PaintMs: number;
    framesSkipped: number;
  };
}

function snapshotLayer(m: LayerMetrics) {
  const avg = m.paintCount === 0 ? 0 : m.paintCostSumMs / m.paintCount;
  const sorted = [...m.rolling].sort((a, b) => a - b);
  const p99 =
    sorted.length === 0
      ? 0
      : sorted[Math.floor(sorted.length * 0.99)] ?? avg;
  return {
    paintCount: m.paintCount,
    avgPaintMs: avg,
    p99PaintMs: p99,
    framesSkipped: m.framesSkipped,
  };
}

/* ============================================================== *\
   Engine
\* ============================================================== */

export interface BoardEngineDeps {
  /** Canvas hosting the board document (shapes, grid, background). */
  shapeCanvas: HTMLCanvasElement;
  /** Canvas hosting remote presence cursors (overlay, pointer-events: none). */
  cursorCanvas: HTMLCanvasElement;
  /** Yjs document — the engine reads the `'shapes'` root Y.Map. */
  doc: Y.Doc;
  /** Awareness instance — drives the cursor canvas. */
  awareness: Awareness;
  /** Board id — drives the per-peer awareness color-slot derivation. */
  boardId: string;
  /** Theme tokens bridge — subscribe once, cache snapshot per flip. */
  themeBridge: {
    current(): ThemeTokensSnapshot;
    subscribe(cb: (snap: ThemeTokensSnapshot) => void): () => void;
  };
}

export class BoardEngine {
  readonly #shapeCanvas: HTMLCanvasElement;
  readonly #shapeCtx: CanvasRenderingContext2D;
  readonly #cursorCanvas: HTMLCanvasElement;
  readonly #cursorCtx: CanvasRenderingContext2D;
  readonly #doc: Y.Doc;
  readonly #awareness: Awareness;
  readonly #boardId: string;
  readonly #themeBridge: BoardEngineDeps['themeBridge'];

  // Render state.
  #running = false;
  #shapeDirty = true;
  #cursorDirty = true;
  #rafHandle: number | null = null;
  #viewport: Viewport = { x: 0, y: 0, w: 0, h: 0 };
  #dpr = 1;

  // Theme cache. The palette derivation runs once per `data-theme`
  // flip; the canvas paint paths read the cached strings.
  #tokens: ThemeTokensSnapshot;
  #palette: DerivedPalette;

  // The shape engine subscribes to `doc.getMap('shapes')` ONCE at
  // start(). The handle is stored for stop() cleanup.
  #shapesMap: Y.Map<unknown> | null = null;
  #shapesMapObserver: (() => void) | null = null;

  // Cursor engine — subscribes to awareness ONCE at start(). The
  // local session id (skipped in painting) is set by the host
  // component after the welcome frame parses.
  #awarenessObserver: (() => void) | null = null;
  #localSessionId: string | null = null;

  // Per-peer cursor render state. Keyed by Yjs `clientID` (the
  // numeric per-connection id, NOT sessionId — two browser tabs share
  // sessionId but have distinct clientIDs).
  #cursors: Map<number, CursorState> = new Map();
  #lastCursorTickMs = 0;
  #cursorTickCount = 0;

  // Theme subscription handle.
  #unsubscribeTheme: (() => void) | null = null;

  // Metrics.
  #shapeMetrics: LayerMetrics = emptyLayerMetrics();
  #cursorMetrics: LayerMetrics = emptyLayerMetrics();
  #frameCount = 0;

  constructor(deps: BoardEngineDeps) {
    const shapeCtx = deps.shapeCanvas.getContext('2d', { alpha: false });
    if (shapeCtx === null) {
      throw new Error(
        'BoardEngine: failed to get 2D context for the shape canvas. ' +
          'The canvas must be attached to the DOM before constructing.',
      );
    }
    const cursorCtx = deps.cursorCanvas.getContext('2d', { alpha: true });
    if (cursorCtx === null) {
      throw new Error(
        'BoardEngine: failed to get 2D context for the cursor canvas.',
      );
    }
    this.#shapeCanvas = deps.shapeCanvas;
    this.#shapeCtx = shapeCtx;
    this.#cursorCanvas = deps.cursorCanvas;
    this.#cursorCtx = cursorCtx;
    this.#doc = deps.doc;
    this.#awareness = deps.awareness;
    this.#boardId = deps.boardId;
    this.#themeBridge = deps.themeBridge;
    this.#tokens = deps.themeBridge.current();
    this.#palette = derivePalette(this.#tokens);
  }

  /* -------------------------------------------------------------- *\
     Lifecycle
  \* -------------------------------------------------------------- */

  start(): void {
    if (this.#running) {
      throw new Error(
        'BoardEngine.start(): already running. The engine is ' +
          'constructed-bound-disposed exactly once — see ADR-008 ' +
          'subscribe-once contract.',
      );
    }
    this.#running = true;
    this.#shapeDirty = true;
    this.#cursorDirty = true;

    // Subscribe ONCE to the root shapes Y.Map. Multiple observer
    // fires inside one frame collapse to ONE paint call on the next
    // rAF tick because the dirty flag is a boolean.
    this.#shapesMap = this.#doc.getMap<unknown>(SHAPES_MAP_KEY);
    const shapeObserver = (): void => {
      this.#shapeDirty = true;
    };
    this.#shapesMap.observe(shapeObserver);
    const shapesMapRef = this.#shapesMap;
    this.#shapesMapObserver = () => {
      shapesMapRef.unobserve(shapeObserver);
    };

    // Subscribe ONCE to awareness. Every change syncs the cursor map
    // from `awareness.getStates()` and flips cursorDirty so the rAF
    // loop paints (or keeps painting through the lerp).
    const awarenessHandler = (): void => {
      this.#syncCursorsFromAwareness();
      this.#cursorDirty = true;
    };
    this.#awareness.on('change', awarenessHandler);
    const awarenessRef = this.#awareness;
    this.#awarenessObserver = () => {
      awarenessRef.off('change', awarenessHandler);
    };
    // Initial sync — peers already in the awareness Map at construct
    // time (Case A from Task 2.5a's seed pipeline notes) are picked up
    // on the first paint pass.
    this.#syncCursorsFromAwareness();

    // Subscribe ONCE to the theme bridge. A theme flip recomputes
    // the OKLCH palette AND dirties both canvases so the next paint
    // uses the new tokens.
    this.#unsubscribeTheme = this.#themeBridge.subscribe((snap) => {
      this.#tokens = snap;
      this.#palette = derivePalette(snap);
      this.#shapeDirty = true;
      this.#cursorDirty = true;
    });

    this.#lastCursorTickMs = performance.now();
    this.#schedule();
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    if (this.#rafHandle !== null) {
      cancelAnimationFrame(this.#rafHandle);
      this.#rafHandle = null;
    }
    if (this.#shapesMapObserver !== null) {
      this.#shapesMapObserver();
      this.#shapesMapObserver = null;
    }
    this.#shapesMap = null;
    if (this.#awarenessObserver !== null) {
      this.#awarenessObserver();
      this.#awarenessObserver = null;
    }
    if (this.#unsubscribeTheme !== null) {
      this.#unsubscribeTheme();
      this.#unsubscribeTheme = null;
    }
    this.#cursors.clear();
  }

  /**
   * Sync both canvas backing-stores to their CSS size for the given
   * DPR. Called from `<BoardCanvasHost />`'s `ResizeObserver`. We do
   * NOT touch `canvas.width` / `canvas.height` on the hot path —
   * resize is a relatively rare event (window resize, side-rail
   * toggle, etc.) and writing the backing-store size triggers a full
   * canvas re-initialisation in the browser.
   *
   * Both canvases share the same CSS dimensions and DPR — they are
   * stacked layers covering the same region.
   */
  handleResize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.#dpr = dpr;
    const widthPx = Math.max(1, Math.round(cssWidth * dpr));
    const heightPx = Math.max(1, Math.round(cssHeight * dpr));

    this.#shapeCanvas.width = widthPx;
    this.#shapeCanvas.height = heightPx;
    this.#cursorCanvas.width = widthPx;
    this.#cursorCanvas.height = heightPx;

    // Reset accumulated transforms (a previous handleResize may have
    // applied a scale) then re-apply the DPR scale so the painter
    // pipeline draws in CSS pixels.
    this.#shapeCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.#shapeCtx.scale(dpr, dpr);
    this.#cursorCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.#cursorCtx.scale(dpr, dpr);

    this.#viewport = { x: 0, y: 0, w: cssWidth, h: cssHeight };
    this.#shapeDirty = true;
    this.#cursorDirty = true;
  }

  /**
   * Set the local session id so the cursor engine skips painting the
   * local cursor (the OS pointer already renders it). Called by the
   * host component after the welcome frame parses.
   */
  setLocalSessionId(sessionId: string | null): void {
    const prev = this.#localSessionId;
    this.#localSessionId = sessionId;
    if (prev === sessionId) return;
    // If a local cursor entry slipped into the map under a previous
    // (null) session id and is now identified as local, evict it so
    // the next paint stops drawing our own cursor.
    if (sessionId !== null) {
      for (const [clientId, state] of this.#cursors) {
        if (state.sessionId === sessionId) {
          this.#cursors.delete(clientId);
        }
      }
      this.#cursorDirty = true;
    }
  }

  getMetrics(): EngineMetrics {
    return {
      shape: snapshotLayer(this.#shapeMetrics),
      cursor: snapshotLayer(this.#cursorMetrics),
    };
  }

  /* -------------------------------------------------------------- *\
     Cursor sync — awareness states → engine render map
  \* -------------------------------------------------------------- */

  #syncCursorsFromAwareness(): void {
    const states = this.#awareness.getStates();
    const localClientId = this.#awareness.clientID;
    const seen = new Set<number>();
    const nowMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    states.forEach((state, clientId) => {
      if (clientId === localClientId) return;
      if (state === null || typeof state !== 'object') return;
      if (!('identity' in state)) return;

      const identityRaw = (state as { identity: unknown }).identity;
      const identity = parseAwarenessIdentity(identityRaw);
      if (!identity.ok) return;

      // Skip peers whose sessionId matches our local session — a
      // second tab in the same browser shares sessionId but has a
      // distinct clientId per ADR-005 ("two tabs = two cursors"), so
      // this branch is dead UNLESS the local id has been set and we
      // somehow connected twice from the same connection. Defensive
      // pre-emption against a future v2 multiplex flow.
      if (
        this.#localSessionId !== null &&
        identity.value.sessionId === this.#localSessionId &&
        clientId === localClientId
      ) {
        return;
      }

      const cursorRaw =
        'cursor' in state ? (state as { cursor: unknown }).cursor : null;
      const cursor = parseAwarenessCursor(cursorRaw);
      const colorSlot = colorSlotFor(identity.value.sessionId, this.#boardId);

      let entry = this.#cursors.get(clientId);
      if (entry === undefined) {
        // New peer. Snap currentX/Y to targetX/Y so the first paint
        // puts the cursor at its actual position, not at origin.
        // If the new peer arrives with `cursor === null` we still
        // create an entry (so a fade-in is possible) but keep opacity
        // at 0 until the first non-null cursor.
        entry = {
          clientId,
          sessionId: identity.value.sessionId,
          emojiChar: identity.value.emojiChar,
          emojiName: identity.value.emojiName,
          colorSlot,
          targetX: cursor?.x ?? null,
          targetY: cursor?.y ?? null,
          currentX: cursor?.x ?? 0,
          currentY: cursor?.y ?? 0,
          opacity: cursor === null ? 0 : 1,
          opacityTarget: cursor === null ? 0 : 1,
          lastTickMs: nowMs,
        };
        this.#cursors.set(clientId, entry);
      } else {
        // Existing peer — identity fields can change (rare: server
        // session-rotate flow per Task 2.5a). Re-read all of them so
        // a re-themed emoji or color slot lands on the next paint.
        entry.sessionId = identity.value.sessionId;
        entry.emojiChar = identity.value.emojiChar;
        entry.emojiName = identity.value.emojiName;
        entry.colorSlot = colorSlot;

        if (cursor === null) {
          // Fade out. Keep targetX/Y at the last known position so
          // currentX/Y can keep tracking until opacity reaches 0.
          entry.targetX = null;
          entry.targetY = null;
          entry.opacityTarget = 0;
        } else {
          if (entry.opacityTarget === 0) {
            // Peer re-entered after a fade-out. Snap currentX/Y to
            // the new position so the fade-in starts where they
            // re-entered, not where they faded out (cleaner visual
            // than a lerp across the dead time).
            entry.currentX = cursor.x;
            entry.currentY = cursor.y;
          }
          entry.targetX = cursor.x;
          entry.targetY = cursor.y;
          entry.opacityTarget = 1;
        }
      }
      seen.add(clientId);
    });

    // Remove peers that disappeared from awareness entirely (a peer
    // disconnected — Yjs fires the change event with the removed
    // clientId no longer in `states`). A clean drop, not a fade —
    // they could be far across the canvas and a fade-out from a
    // stale position would draw a confusing ghost.
    for (const clientId of this.#cursors.keys()) {
      if (!seen.has(clientId)) {
        this.#cursors.delete(clientId);
      }
    }
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
    // Advance cursor lerp + opacity ramps BEFORE the paint so the
    // current frame paints the freshly-advanced positions. The motion
    // flag returned here is used AFTER paint to keep the loop primed
    // for the next frame.
    const motionStillActive = this.#advanceCursors();

    // Shape paint — only if dirty.
    if (this.#shapeDirty) {
      this.#paintShapeLayer();
      this.#shapeDirty = false;
    } else {
      this.#shapeMetrics.framesSkipped += 1;
    }

    // Cursor paint — only if dirty.
    if (this.#cursorDirty) {
      this.#paintCursorLayer();
      this.#cursorDirty = false;
    } else {
      this.#cursorMetrics.framesSkipped += 1;
    }

    // Keep cursorDirty true while any cursor is still in motion or
    // fading — the rAF loop reads this on the next tick and repaints
    // the new positions. Set AFTER the paint clear so the just-painted
    // frame's dirty flip survives into the next tick.
    if (motionStillActive) {
      this.#cursorDirty = true;
    }

    this.#frameCount += 1;

    // Dev FPS log every 240 frames. The literal check is folded to a
    // constant in production by Next's `DefinePlugin`; Terser DCEs
    // the always-false branch and the log + the format string are
    // stripped from the production bundle.
    if (process.env.NODE_ENV === 'development') {
      if (this.#frameCount % DEV_FPS_LOG_FRAMES === 0) {
        this.#logDevMetrics();
      }
    }
  }

  #advanceCursors(): boolean {
    const nowMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.max(0, nowMs - this.#lastCursorTickMs);
    this.#lastCursorTickMs = nowMs;

    if (this.#cursors.size === 0) return false;

    // Critical-damped lerp coefficient. `1 - exp(-dt / tau)` is the
    // fraction of the remaining gap to close this tick — at dt = tau
    // ~63 %, at dt = 4 × tau ~98 %, asymptotically 1. With tau = 30 ms
    // the cursor lands within 0.5 px of target at ~120 ms (4 × tau).
    const lerpAlpha = 1 - Math.exp(-dt / CURSOR_LERP_TAU_MS);
    // Opacity ramp moves linearly at `1 / RAMP_MS` per ms — 5 ms per
    // 1 % opacity is sub-frame at 60 fps.
    const opacityStep = dt / CURSOR_OPACITY_RAMP_MS;

    let anyInMotion = false;
    const toRemove: number[] = [];

    for (const entry of this.#cursors.values()) {
      // Position lerp — only if we have a target. A fading-out cursor
      // (target* === null) freezes at its current position.
      if (entry.targetX !== null && entry.targetY !== null) {
        const dx = entry.targetX - entry.currentX;
        const dy = entry.targetY - entry.currentY;
        if (
          Math.abs(dx) > CURSOR_SETTLED_THRESHOLD_PX ||
          Math.abs(dy) > CURSOR_SETTLED_THRESHOLD_PX
        ) {
          entry.currentX += dx * lerpAlpha;
          entry.currentY += dy * lerpAlpha;
          anyInMotion = true;
        } else {
          // Snap on settle so the cursor parks exactly on target
          // (avoids floating-point creep on subsequent ticks).
          entry.currentX = entry.targetX;
          entry.currentY = entry.targetY;
        }
      }

      // Opacity ramp.
      if (entry.opacity !== entry.opacityTarget) {
        if (entry.opacity < entry.opacityTarget) {
          entry.opacity = Math.min(
            entry.opacityTarget,
            entry.opacity + opacityStep,
          );
        } else {
          entry.opacity = Math.max(
            entry.opacityTarget,
            entry.opacity - opacityStep,
          );
        }
        anyInMotion = true;
        // Fade-out reaching 0 evicts the peer entirely. Re-entry will
        // recreate the entry with a snapped position.
        if (entry.opacity <= 0 && entry.opacityTarget <= 0) {
          toRemove.push(entry.clientId);
        }
      }

      entry.lastTickMs = nowMs;
    }

    for (const clientId of toRemove) {
      this.#cursors.delete(clientId);
    }

    // Mark the cursor canvas dirty while motion is in flight so the
    // CURRENT frame paints. `#tick` keeps the next frame primed by
    // re-setting cursorDirty after paint via the returned boolean.
    if (anyInMotion) {
      this.#cursorDirty = true;
    }

    // Dev presence log every N cursor ticks. Same DCE pattern as the
    // FPS log — the literal is constant-folded in production.
    if (process.env.NODE_ENV === 'development') {
      this.#cursorTickCount += 1;
      if (this.#cursorTickCount % DEV_PRESENCE_LOG_FRAMES === 0) {
        this.#logPresence();
      }
    }
    return anyInMotion;
  }

  #paintShapeLayer(): void {
    const vp = this.#viewport;
    if (vp.w <= 0 || vp.h <= 0) return;
    if (this.#shapesMap === null) return;

    const t0 =
      process.env.NODE_ENV === 'development' ? performance.now() : 0;

    paintBackground(this.#shapeCtx, vp, this.#palette.bg);
    paintGrid(this.#shapeCtx, vp, this.#palette.grid);
    paintShapes(this.#shapeCtx, vp, this.#shapesMap, this.#palette.shapes);

    if (process.env.NODE_ENV === 'development') {
      const dt = performance.now() - t0;
      this.#shapeMetrics.paintCount += 1;
      this.#shapeMetrics.paintCostSumMs += dt;
      this.#shapeMetrics.rolling.push(dt);
      if (this.#shapeMetrics.rolling.length > 240) {
        this.#shapeMetrics.rolling.shift();
      }
    } else {
      this.#shapeMetrics.paintCount += 1;
    }
  }

  #paintCursorLayer(): void {
    const vp = this.#viewport;
    if (vp.w <= 0 || vp.h <= 0) return;

    const t0 =
      process.env.NODE_ENV === 'development' ? performance.now() : 0;

    // Clear the cursor canvas — cursors are transparent overlay, so
    // every frame starts with a fresh transparent canvas (vs the
    // shape canvas which fills the background first).
    this.#cursorCtx.clearRect(vp.x, vp.y, vp.w, vp.h);

    // Materialise a view of the engine's cursor map for the painter.
    // Cheap (one Object literal per peer, max 8 per the ADR-005 wheel)
    // and keeps the painter pure — no engine internals leak.
    const view: CursorRenderState[] = [];
    for (const entry of this.#cursors.values()) {
      view.push({
        clientId: entry.clientId,
        currentX: entry.currentX,
        currentY: entry.currentY,
        opacity: entry.opacity,
        emojiChar: entry.emojiChar,
        emojiName: entry.emojiName,
        colorSlot: entry.colorSlot,
      });
    }

    paintCursors(this.#cursorCtx, vp, view, this.#palette.cursors);

    if (process.env.NODE_ENV === 'development') {
      const dt = performance.now() - t0;
      this.#cursorMetrics.paintCount += 1;
      this.#cursorMetrics.paintCostSumMs += dt;
      this.#cursorMetrics.rolling.push(dt);
      if (this.#cursorMetrics.rolling.length > 240) {
        this.#cursorMetrics.rolling.shift();
      }
    } else {
      this.#cursorMetrics.paintCount += 1;
    }
  }

  #logDevMetrics(): void {
    // Gated by the caller — the literal check stays in `#tick` so
    // Terser DCE removes the whole `#logDevMetrics` body inlining
    // chain in production.
    const shape = snapshotLayer(this.#shapeMetrics);
    const cursor = snapshotLayer(this.#cursorMetrics);
    console.log(
      `[meld-engine] shape avg=${shape.avgPaintMs.toFixed(2)}ms ` +
        `p99=${shape.p99PaintMs.toFixed(2)}ms ` +
        `frames=${shape.paintCount} skipped=${shape.framesSkipped}`,
    );
    console.log(
      `[meld-engine] cursor avg=${cursor.avgPaintMs.toFixed(2)}ms ` +
        `p99=${cursor.p99PaintMs.toFixed(2)}ms ` +
        `frames=${cursor.paintCount} skipped=${cursor.framesSkipped}`,
    );
  }

  #logPresence(): void {
    // Caller gates on NODE_ENV. Format mirrors the Phase 2.6 + 2.5a
    // observability pattern: prefixed bracket tag + key=value pairs.
    const names: string[] = [];
    for (const entry of this.#cursors.values()) {
      names.push(`${entry.emojiName}@${entry.opacity.toFixed(2)}`);
    }
    console.log(
      `[meld-presence] cursors=${this.#cursors.size.toString()} ` +
        `states=[${names.join(',')}]`,
    );
  }

  /* -------------------------------------------------------------- *\
     Test-only accessors. Not part of the production surface.
  \* -------------------------------------------------------------- */

  /** @internal */
  _testGetState() {
    return {
      running: this.#running,
      shapeDirty: this.#shapeDirty,
      cursorDirty: this.#cursorDirty,
      viewport: this.#viewport,
      dpr: this.#dpr,
      paletteBg: this.#palette.bg,
      paletteGrid: this.#palette.grid,
      shapeMapBound: this.#shapesMap !== null,
      localSessionId: this.#localSessionId,
    };
  }

  /** @internal */
  _testTick(): void {
    this.#tick();
  }

  /** @internal — snapshot of the cursor render map for assertions. */
  _testCursors(): ReadonlyArray<{
    clientId: number;
    sessionId: string;
    targetX: number | null;
    targetY: number | null;
    currentX: number;
    currentY: number;
    opacity: number;
    opacityTarget: number;
    colorSlot: number;
    emojiName: string;
  }> {
    return Array.from(this.#cursors.values()).map((e) => ({
      clientId: e.clientId,
      sessionId: e.sessionId,
      targetX: e.targetX,
      targetY: e.targetY,
      currentX: e.currentX,
      currentY: e.currentY,
      opacity: e.opacity,
      opacityTarget: e.opacityTarget,
      colorSlot: e.colorSlot,
      emojiName: e.emojiName,
    }));
  }

  /**
   * Force-advance the lerp + opacity ramps by `dtMs` virtual ms. Used
   * by tests to drive convergence without spinning a real clock. The
   * production loop reads `performance.now()` deltas; in tests we
   * rewind `lastCursorTickMs` and call `#advanceCursors` directly.
   *
   * @internal
   */
  _testAdvanceCursors(dtMs: number): void {
    this.#lastCursorTickMs =
      (typeof performance !== 'undefined'
        ? performance.now()
        : Date.now()) - dtMs;
    this.#advanceCursors();
  }
}
