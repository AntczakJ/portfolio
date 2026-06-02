/**
 * Freehand draft — in-memory point accumulation for the pen/freehand
 * tool (ADR-010, option F2).
 *
 * The pen tool's live feedback comes from a LOCAL preview canvas, NOT
 * from Yjs. During the drag we accumulate sampled points in this
 * in-memory draft and repaint the stroke-so-far on the preview canvas;
 * on pointerup we commit the WHOLE stroke as ONE Yjs op (a single root
 * `set` inside one `doc.transact`).
 *
 * Why a separate module (not inline in the overlay)? The decimation
 * policy — the load-bearing bit that keeps a stroke from becoming an
 * unbounded point array AND keeps the single commit op small — is pure
 * arithmetic with no DOM dependency. Extracting it lets the test suite
 * drive the min-distance gate, the time gate, and the 2000-point
 * ceiling without a jsdom canvas. The overlay just owns the pointer
 * plumbing.
 *
 * ADR-010 decimation contract:
 *
 *   - Admit a new sample only if it is at least
 *     `FREEHAND_MIN_POINT_DISTANCE_PX` (2 px) from the last admitted
 *     point OR at least `FREEHAND_MIN_POINT_INTERVAL_MS` (16 ms) have
 *     elapsed since the last admitted sample. The distance gate is the
 *     primary filter (a fast scribble produces few points); the time
 *     gate is the fallback so a SLOW deliberate drag (the pointer
 *     barely moving but the user genuinely drawing) still records.
 *   - A hard ceiling `FREEHAND_MAX_POINTS` (2000) caps a pathological
 *     stroke. On overflow we DROP further interior samples rather than
 *     refusing to draw — but `finalize()` ALWAYS keeps the final
 *     pointerup point so the committed stroke ends where the user lifted.
 *
 * Coordinate convention — matches the shapes painter
 * (`painters/shapes.ts` `paintFreehand`): the draft stores a `baseX`/
 * `baseY` (the first point, in canvas/board space) and every point is
 * an OFFSET from that base. The painter reads `x` + `y` off the shape's
 * Y.Map as the base and adds each point's offset. So the first admitted
 * point is `{ x: 0, y: 0 }` and every later point is `{ x: cx - baseX,
 * y: cy - baseY }`. `createShape({ kind: 'freehand', x: baseX, y: baseY,
 * initialPoints })` reproduces the exact shape a completed stroke
 * produced under the old incremental-append path.
 */

import type { FreehandPoint } from '@/lib/shapes/types';

/**
 * Minimum on-canvas distance (CSS px) between two admitted freehand
 * points. The distance gate is the primary decimation filter.
 */
export const FREEHAND_MIN_POINT_DISTANCE_PX = 2;

/**
 * Fallback time gate (ms). A sample closer than the distance threshold
 * is STILL admitted if this much time has elapsed since the last
 * admitted point, so a slow deliberate drag records its points.
 */
export const FREEHAND_MIN_POINT_INTERVAL_MS = 16;

/**
 * Hard ceiling on the number of points a single stroke may hold. A
 * pathological multi-minute scribble cannot grow the in-memory draft
 * (or the single commit op) without bound. On overflow further interior
 * samples are dropped; the final pointerup point is always kept.
 */
export const FREEHAND_MAX_POINTS = 2000;

export interface FreehandDraftSample {
  /** Canvas-space x (overlay-relative CSS px). */
  x: number;
  /** Canvas-space y (overlay-relative CSS px). */
  y: number;
  /** `performance.now()` timestamp of the sample. */
  tMs: number;
}

/**
 * Accumulates decimated freehand points during a drag. Construct on
 * pointerdown with the first point; `push` each pointermove sample;
 * `finalize` on pointerup to get the full offset-point list ready for
 * `createShape({ kind: 'freehand', initialPoints })`.
 */
export class FreehandDraft {
  readonly baseX: number;
  readonly baseY: number;

  // Admitted points, as OFFSETS from (baseX, baseY) — the painter's
  // convention. The first is always { x: 0, y: 0 }.
  #points: FreehandPoint[] = [];

  // Bookkeeping for the decimation gates — the last admitted point in
  // CANVAS space + its timestamp.
  #lastX: number;
  #lastY: number;
  #lastAdmitMs: number;

  // Once the ceiling is hit we stop admitting interior points. The
  // final pointerup point is still appended by `finalize`.
  #ceilingHit = false;

  constructor(first: FreehandDraftSample) {
    this.baseX = first.x;
    this.baseY = first.y;
    this.#points.push({ x: 0, y: 0 });
    this.#lastX = first.x;
    this.#lastY = first.y;
    this.#lastAdmitMs = first.tMs;
  }

  /**
   * Offer a sampled pointermove. Returns `true` if the point was
   * admitted (the preview should repaint), `false` if it was decimated
   * away or dropped at the ceiling.
   */
  push(sample: FreehandDraftSample): boolean {
    if (this.#ceilingHit) return false;

    const dx = sample.x - this.#lastX;
    const dy = sample.y - this.#lastY;
    const distance = Math.hypot(dx, dy);
    const elapsed = sample.tMs - this.#lastAdmitMs;

    const farEnough = distance >= FREEHAND_MIN_POINT_DISTANCE_PX;
    const slowEnough = elapsed >= FREEHAND_MIN_POINT_INTERVAL_MS;
    if (!farEnough && !slowEnough) return false;

    this.#admit(sample);

    // Reaching the ceiling latches the drop flag. Reserve one slot so
    // `finalize` can always append the pointerup point even at the cap.
    if (this.#points.length >= FREEHAND_MAX_POINTS) {
      this.#ceilingHit = true;
    }
    return true;
  }

  /**
   * Append the final pointerup point (always kept, even at the ceiling)
   * and return the complete offset-point list. The returned array is a
   * copy — the draft is single-use, but a defensive copy keeps the
   * caller from mutating internal state.
   *
   * If the final point coincides with the last admitted point it is not
   * duplicated (a tap that never moved produces a single-point stroke,
   * which the painter renders as a dot).
   */
  finalize(final: { x: number; y: number }): readonly FreehandPoint[] {
    const offsetX = final.x - this.baseX;
    const offsetY = final.y - this.baseY;
    const last = this.#points[this.#points.length - 1];
    const coincides =
      last !== undefined &&
      Math.abs(last.x - offsetX) < 1e-6 &&
      Math.abs(last.y - offsetY) < 1e-6;
    if (!coincides) {
      this.#points.push({ x: offsetX, y: offsetY });
    }
    return [...this.#points];
  }

  /**
   * Snapshot the admitted points so far (offsets from base). Used by
   * the preview painter every pointermove to draw the stroke-so-far.
   * Returns the live array reference for zero-allocation reads on the
   * hot path — the preview painter only iterates, never mutates.
   */
  points(): readonly FreehandPoint[] {
    return this.#points;
  }

  /** Number of admitted points (test + telemetry aid). */
  get length(): number {
    return this.#points.length;
  }

  /** Whether the 2000-point ceiling has been reached. */
  get ceilingHit(): boolean {
    return this.#ceilingHit;
  }

  #admit(sample: FreehandDraftSample): void {
    this.#points.push({
      x: sample.x - this.baseX,
      y: sample.y - this.baseY,
    });
    this.#lastX = sample.x;
    this.#lastY = sample.y;
    this.#lastAdmitMs = sample.tMs;
  }
}
