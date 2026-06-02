/**
 * Freehand draft tests — ADR-010 option F2.
 *
 * Covers the in-memory point accumulation + the decimation policy that
 * replaced the per-pointermove Yjs nested appends:
 *
 *   - min-distance gate (2 px) admits a far point, decimates a near one,
 *   - the 16 ms time gate admits a near point when enough time elapsed,
 *   - the 2000-point ceiling caps the array and latches,
 *   - `finalize` always keeps the pointerup point + produces the full
 *     offset-point list,
 *   - the full commit flow (draft → `createShape({ initialPoints })` →
 *     one root `set` in one `doc.transact`) produces EXACTLY ONE shape
 *     carrying the whole point list — the load-bearing "one op per
 *     stroke" property.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  FreehandDraft,
  FREEHAND_MAX_POINTS,
  FREEHAND_MIN_POINT_DISTANCE_PX,
  FREEHAND_MIN_POINT_INTERVAL_MS,
} from '../freehand-draft';
import {
  createShape,
  readFreehandPoints,
  readNumber,
  readShapeKind,
  SHAPES_ROOT_KEY,
} from '@/lib/shapes/types';

describe('FreehandDraft — construction', () => {
  it('seeds the first point as the { 0, 0 } base offset', () => {
    const draft = new FreehandDraft({ x: 100, y: 50, tMs: 0 });
    expect(draft.baseX).toBe(100);
    expect(draft.baseY).toBe(50);
    expect(draft.length).toBe(1);
    expect(draft.points()[0]).toEqual({ x: 0, y: 0 });
  });
});

describe('FreehandDraft — min-distance gate', () => {
  it('admits a point at or beyond the 2 px distance threshold', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    // 2 px away, same instant (time gate not yet satisfied) — distance
    // gate admits it.
    const admitted = draft.push({ x: FREEHAND_MIN_POINT_DISTANCE_PX, y: 0, tMs: 0 });
    expect(admitted).toBe(true);
    expect(draft.length).toBe(2);
    expect(draft.points()[1]).toEqual({ x: 2, y: 0 });
  });

  it('decimates a point closer than 2 px within the time gate', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    // 1 px away, 5 ms later — fails BOTH the distance (1 < 2) and the
    // time (5 < 16) gate.
    const admitted = draft.push({ x: 1, y: 0, tMs: 5 });
    expect(admitted).toBe(false);
    expect(draft.length).toBe(1);
  });
});

describe('FreehandDraft — time gate fallback', () => {
  it('admits a sub-threshold point once 16 ms have elapsed', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    // 1 px away (below distance gate) but 16 ms later — the time gate
    // admits it so a slow deliberate drag still records.
    const admitted = draft.push({
      x: 1,
      y: 0,
      tMs: FREEHAND_MIN_POINT_INTERVAL_MS,
    });
    expect(admitted).toBe(true);
    expect(draft.length).toBe(2);
  });

  it('resets the gates relative to the LAST admitted point', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    // Admit at t=16 (time gate).
    expect(draft.push({ x: 1, y: 0, tMs: 16 })).toBe(true);
    // 1 px further, only 5 ms after the last ADMITTED point — decimated.
    expect(draft.push({ x: 2, y: 0, tMs: 21 })).toBe(false);
    expect(draft.length).toBe(2);
  });
});

describe('FreehandDraft — 2000-point ceiling', () => {
  it('caps the array at FREEHAND_MAX_POINTS and latches', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    // Feed far-apart points so every one passes the distance gate.
    let t = 0;
    let admittedCount = 1; // the seed point
    for (let i = 1; i < FREEHAND_MAX_POINTS + 500; i += 1) {
      t += 20;
      const ok = draft.push({ x: i * 10, y: 0, tMs: t });
      if (ok) admittedCount += 1;
    }
    expect(draft.length).toBe(FREEHAND_MAX_POINTS);
    expect(draft.ceilingHit).toBe(true);
    expect(admittedCount).toBe(FREEHAND_MAX_POINTS);
    // Further pushes are dropped.
    expect(draft.push({ x: 999_999, y: 0, tMs: t + 100 })).toBe(false);
    expect(draft.length).toBe(FREEHAND_MAX_POINTS);
  });
});

describe('FreehandDraft — finalize', () => {
  it('appends the pointerup point as a base offset', () => {
    const draft = new FreehandDraft({ x: 10, y: 10, tMs: 0 });
    draft.push({ x: 20, y: 10, tMs: 20 });
    const points = draft.finalize({ x: 40, y: 10 });
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[1]).toEqual({ x: 10, y: 0 });
    expect(points[2]).toEqual({ x: 30, y: 0 });
  });

  it('does not duplicate a pointerup point that coincides with the last admitted', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    draft.push({ x: 10, y: 0, tMs: 20 });
    // pointerup at the same place as the last admitted point.
    const points = draft.finalize({ x: 10, y: 0 });
    expect(points).toHaveLength(2);
  });

  it('keeps the pointerup point even at the ceiling', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    let t = 0;
    for (let i = 1; i < FREEHAND_MAX_POINTS + 50; i += 1) {
      t += 20;
      draft.push({ x: i * 10, y: 0, tMs: t });
    }
    expect(draft.length).toBe(FREEHAND_MAX_POINTS);
    const points = draft.finalize({ x: 5_000_000, y: 123 });
    // Ceiling + 1 final point.
    expect(points).toHaveLength(FREEHAND_MAX_POINTS + 1);
    expect(points[points.length - 1]).toEqual({ x: 5_000_000, y: 123 });
  });

  it('a single-tap stroke finalizes to one point (a dot)', () => {
    const draft = new FreehandDraft({ x: 7, y: 7, tMs: 0 });
    const points = draft.finalize({ x: 7, y: 7 });
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({ x: 0, y: 0 });
  });
});

describe('FreehandDraft — single-commit shape (one op per stroke)', () => {
  it('produces EXACTLY ONE root shape carrying the full point list', () => {
    // Simulate the overlay's pointerup commit flow: accumulate a draft,
    // finalize, build the shape, insert once in one transact.
    const draft = new FreehandDraft({ x: 100, y: 100, tMs: 0 });
    draft.push({ x: 110, y: 105, tMs: 20 });
    draft.push({ x: 130, y: 120, tMs: 40 });
    draft.push({ x: 160, y: 160, tMs: 60 });
    const initialPoints = draft.finalize({ x: 200, y: 200 });

    const doc = new Y.Doc();
    const root = doc.getMap(SHAPES_ROOT_KEY);

    let transactCount = 0;
    doc.on('afterTransaction', () => {
      transactCount += 1;
    });

    const { id, map } = createShape({
      kind: 'freehand',
      x: draft.baseX,
      y: draft.baseY,
      initialPoints,
      colorSlot: 3,
      sessionId: 'session-A',
    });
    doc.transact(() => {
      root.set(id, map);
    });

    // ONE transaction = one op on the wire (the load-bearing property).
    expect(transactCount).toBe(1);
    // EXACTLY one shape in the root map.
    expect(root.size).toBe(1);

    const stored = root.get(id);
    expect(stored).toBeInstanceOf(Y.Map);
    if (!(stored instanceof Y.Map)) return;
    expect(readShapeKind(stored)).toBe('freehand');
    expect(readNumber(stored, 'x', -1)).toBe(100);
    expect(readNumber(stored, 'y', -1)).toBe(100);

    const points = readFreehandPoints(stored);
    expect(points).not.toBeNull();
    if (points === null) return;
    // 1 seed + 3 admitted + 1 finalize = 5 points, all carried in the
    // single commit (NOT incrementally appended).
    expect(points.length).toBe(initialPoints.length);
    expect(points.length).toBe(5);
    expect(points.get(0)).toEqual({ x: 0, y: 0 });
    expect(points.get(4)).toEqual({ x: 100, y: 100 });
  });

  it('round-trips the committed stroke to a remote doc with all points', () => {
    const draft = new FreehandDraft({ x: 0, y: 0, tMs: 0 });
    draft.push({ x: 10, y: 0, tMs: 20 });
    draft.push({ x: 20, y: 5, tMs: 40 });
    const initialPoints = draft.finalize({ x: 30, y: 10 });

    const docA = new Y.Doc();
    const { id, map } = createShape({
      kind: 'freehand',
      x: 0,
      y: 0,
      initialPoints,
      colorSlot: 0,
      sessionId: 's',
    });
    docA.transact(() => {
      docA.getMap(SHAPES_ROOT_KEY).set(id, map);
    });

    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);

    const remote = docB.getMap(SHAPES_ROOT_KEY).get(id);
    expect(remote).toBeInstanceOf(Y.Map);
    if (!(remote instanceof Y.Map)) return;
    const points = readFreehandPoints(remote);
    expect(points?.length).toBe(initialPoints.length);
  });
});
