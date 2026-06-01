/**
 * Shape data-model tests — Phase 3.2.
 *
 * We assert:
 *
 *   - `createShape` produces a `Y.Map<unknown>` with all the common
 *     fields filled in (id, kind, timestamps, authorship, colorSlot
 *     clamped to 0..7),
 *   - per-kind branches add the right discriminator-specific fields
 *     (`w` / `h` for rectangle + ellipse, `points` Y.Array for
 *     freehand, `text` + `fontSize` for text),
 *   - the colorSlot derivation mirrors the server's FNV-1a verbatim
 *     so a shape drawn locally resolves to the same hue the server
 *     reports in the welcome frame,
 *   - `updateShape` patches without dropping co-fields and bumps the
 *     `lastEditedBy` / `lastEditedAtMs` pair,
 *   - the round-trip through `Y.encodeStateAsUpdate` + `Y.applyUpdate`
 *     is bit-exact (the load-bearing CRDT property).
 *
 * IMPORTANT: Y.Map.get() on a DETACHED Y.Map returns `undefined` and
 * emits an "Invalid access: Add Yjs type to a document before reading
 * data" warning. Every assertion below first attaches the shape map
 * to a `doc.getMap('shapes')` root before reading — this matches the
 * production write path (the pointer overlay's `doc.transact(() =>
 * rootMap.set(id, createShape({...})))`). The detached-write-then-
 * attached-read pattern is the only legal use; detached reads are
 * NOT a supported Y.Map operation.
 *
 * The painter is NOT tested here — jsdom has no Canvas2D, and the
 * painter tests are documented as optional in the brief (canvas mocks
 * are brittle; the Y.Map writes are the load-bearing surface).
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { colorSlotFor, fnv1a32 } from '../../identity/fnv1a';
import { isShapeKind, SHAPE_KINDS } from '../kinds';
import {
  appendFreehandPoint,
  createShape,
  type CreateShapeInput,
  DEFAULT_TEXT_FONT_SIZE,
  readFreehandPoints,
  readNumber,
  readShapeKind,
  readString,
  SHAPES_ROOT_KEY,
  updateShape,
} from '../types';

/* ============================================================== *\
   Test harness — attach the shape into a doc before reading.
\* ============================================================== */

interface AttachedShape {
  doc: Y.Doc;
  shapeMap: Y.Map<unknown>;
  shapeId: string;
}

function attach(input: CreateShapeInput): AttachedShape {
  const doc = new Y.Doc();
  const root = doc.getMap(SHAPES_ROOT_KEY);
  const { id: shapeId, map: shapeMap } = createShape(input);
  doc.transact(() => {
    root.set(shapeId, shapeMap);
  });
  return { doc, shapeMap, shapeId };
}

/* ============================================================== *\
   FNV-1a + colorSlot mirror tests
\* ============================================================== */

describe('fnv1a32', () => {
  it("returns the canonical offset basis for the empty string", () => {
    expect(fnv1a32('')).toBe(2_166_136_261);
  });

  it('is deterministic', () => {
    expect(fnv1a32('meld')).toBe(fnv1a32('meld'));
  });

  it('distinguishes case', () => {
    expect(fnv1a32('Meld')).not.toBe(fnv1a32('meld'));
  });

  it('is non-negative for arbitrary inputs', () => {
    for (const seed of ['', 'a', '0', 'meld', 'a-very-long-string']) {
      const h = fnv1a32(seed);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('colorSlotFor', () => {
  it('returns an integer in [0..7]', () => {
    for (const session of ['s1', 's2', 's3']) {
      for (const board of ['b1', 'b2']) {
        const slot = colorSlotFor(session, board);
        expect(Number.isInteger(slot)).toBe(true);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThanOrEqual(7);
      }
    }
  });

  it('is deterministic for a fixed (sessionId, boardId) pair', () => {
    expect(colorSlotFor('s1', 'b1')).toBe(colorSlotFor('s1', 'b1'));
  });

  it("varies the slot per board (the per-board collision-avoidance contract)", () => {
    // The exact distribution depends on FNV-1a; the load-bearing
    // assertion is that DIFFERENT board ids almost always yield
    // different slots for the same session id. Empirically across 64
    // board ids only a handful collide — assert that at least 4
    // distinct slots appear.
    const slots = new Set<number>();
    for (let i = 0; i < 64; i += 1) {
      slots.add(colorSlotFor('session-1234', `board-${i.toString()}`));
    }
    expect(slots.size).toBeGreaterThanOrEqual(4);
  });
});

/* ============================================================== *\
   Kind narrowing
\* ============================================================== */

describe('isShapeKind', () => {
  it("admits all four v1 shape kinds", () => {
    for (const k of SHAPE_KINDS) {
      expect(isShapeKind(k)).toBe(true);
    }
  });

  it('rejects arrow + select + arbitrary strings', () => {
    expect(isShapeKind('arrow')).toBe(false);
    expect(isShapeKind('select')).toBe(false);
    expect(isShapeKind('')).toBe(false);
    expect(isShapeKind('Rectangle')).toBe(false);
  });
});

/* ============================================================== *\
   createShape — common fields
\* ============================================================== */

describe('createShape — common fields', () => {
  it('attaches into a doc carrying all common fields for a rectangle', () => {
    const { shapeMap, shapeId } = attach({
      kind: 'rectangle',
      x: 10,
      y: 20,
      w: 100,
      h: 50,
      colorSlot: 3,
      sessionId: 'session-A',
    });
    expect(shapeMap).toBeInstanceOf(Y.Map);
    expect(readShapeKind(shapeMap)).toBe('rectangle');
    expect(typeof shapeId).toBe('string');
    expect(shapeId.length).toBeGreaterThan(8);
    expect(shapeMap.get('id')).toBe(shapeId);
    expect(readNumber(shapeMap, 'x', -1)).toBe(10);
    expect(readNumber(shapeMap, 'y', -1)).toBe(20);
    expect(readNumber(shapeMap, 'w', -1)).toBe(100);
    expect(readNumber(shapeMap, 'h', -1)).toBe(50);
    expect(readNumber(shapeMap, 'colorSlot', -1)).toBe(3);
    expect(readString(shapeMap, 'createdBy', '')).toBe('session-A');
    expect(readString(shapeMap, 'lastEditedBy', '')).toBe('session-A');
    const created = readNumber(shapeMap, 'createdAtMs', -1);
    expect(Number.isFinite(created)).toBe(true);
    expect(created).toBeGreaterThan(0);
    expect(readNumber(shapeMap, 'lastEditedAtMs', -1)).toBe(created);
  });

  it('clamps colorSlot to [0..7]', () => {
    const high = attach({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      colorSlot: 99,
      sessionId: 's',
    });
    expect(readNumber(high.shapeMap, 'colorSlot', -1)).toBe(7);
    const low = attach({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      colorSlot: -4,
      sessionId: 's',
    });
    expect(readNumber(low.shapeMap, 'colorSlot', -1)).toBe(0);
    const nan = attach({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      colorSlot: Number.NaN,
      sessionId: 's',
    });
    expect(readNumber(nan.shapeMap, 'colorSlot', -1)).toBe(0);
  });

  it("generates a unique id per call", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      const { shapeId } = attach({
        kind: 'rectangle',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        colorSlot: 0,
        sessionId: 's',
      });
      ids.add(shapeId);
    }
    expect(ids.size).toBe(64);
  });
});

/* ============================================================== *\
   createShape — per-kind branches
\* ============================================================== */

describe('createShape — ellipse', () => {
  it('writes w + h same as rectangle', () => {
    const { shapeMap } = attach({
      kind: 'ellipse',
      x: 1,
      y: 2,
      w: 80,
      h: 40,
      colorSlot: 1,
      sessionId: 's',
    });
    expect(readShapeKind(shapeMap)).toBe('ellipse');
    expect(readNumber(shapeMap, 'w', -1)).toBe(80);
    expect(readNumber(shapeMap, 'h', -1)).toBe(40);
  });
});

describe('createShape — freehand', () => {
  it("seeds the points Y.Array with the supplied initialPoints", () => {
    const { shapeMap } = attach({
      kind: 'freehand',
      x: 0,
      y: 0,
      initialPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 12, pressure: 0.7 },
      ],
      colorSlot: 2,
      sessionId: 's',
    });
    expect(readShapeKind(shapeMap)).toBe('freehand');
    const points = readFreehandPoints(shapeMap);
    expect(points).not.toBeNull();
    if (points === null) return;
    expect(points.length).toBe(3);
    expect(points.get(2)?.pressure).toBe(0.7);
  });

  it("admits an empty initialPoints array", () => {
    const { shapeMap } = attach({
      kind: 'freehand',
      x: 0,
      y: 0,
      initialPoints: [],
      colorSlot: 0,
      sessionId: 's',
    });
    const points = readFreehandPoints(shapeMap);
    expect(points).not.toBeNull();
    if (points === null) return;
    expect(points.length).toBe(0);
  });

  it("appendFreehandPoint pushes to the Y.Array and bumps lastEditedAtMs", async () => {
    const { doc, shapeMap } = attach({
      kind: 'freehand',
      x: 0,
      y: 0,
      initialPoints: [{ x: 0, y: 0 }],
      colorSlot: 0,
      sessionId: 'author-A',
    });
    const originalEditMs = readNumber(shapeMap, 'lastEditedAtMs', -1);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    doc.transact(() => {
      appendFreehandPoint(shapeMap, { x: 5, y: 6 }, 'author-B');
    });
    const points = readFreehandPoints(shapeMap);
    expect(points).not.toBeNull();
    if (points === null) return;
    expect(points.length).toBe(2);
    expect(points.get(1)).toEqual({ x: 5, y: 6 });
    expect(readString(shapeMap, 'lastEditedBy', '')).toBe('author-B');
    expect(readNumber(shapeMap, 'lastEditedAtMs', -1)).toBeGreaterThanOrEqual(
      originalEditMs,
    );
  });
});

describe('createShape — text', () => {
  it("carries text + fontSize", () => {
    const { shapeMap } = attach({
      kind: 'text',
      x: 4,
      y: 4,
      text: 'hello',
      fontSize: 24,
      colorSlot: 5,
      sessionId: 's',
    });
    expect(readShapeKind(shapeMap)).toBe('text');
    expect(readString(shapeMap, 'text', '')).toBe('hello');
    expect(readNumber(shapeMap, 'fontSize', -1)).toBe(24);
  });

  it("DEFAULT_TEXT_FONT_SIZE is in the painter's clamp range", () => {
    expect(DEFAULT_TEXT_FONT_SIZE).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_TEXT_FONT_SIZE).toBeLessThanOrEqual(96);
  });
});

/* ============================================================== *\
   updateShape
\* ============================================================== */

describe('updateShape', () => {
  it('writes only the supplied fields and bumps the lastEdited pair', async () => {
    const { doc, shapeMap } = attach({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      colorSlot: 0,
      sessionId: 'author-A',
    });
    const beforeMs = readNumber(shapeMap, 'lastEditedAtMs', -1);
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    doc.transact(() => {
      updateShape(shapeMap, { x: 50, w: 200 }, 'author-B');
    });
    expect(readNumber(shapeMap, 'x', -1)).toBe(50);
    expect(readNumber(shapeMap, 'y', -1)).toBe(0); // untouched
    expect(readNumber(shapeMap, 'w', -1)).toBe(200);
    expect(readNumber(shapeMap, 'h', -1)).toBe(100); // untouched
    expect(readString(shapeMap, 'lastEditedBy', '')).toBe('author-B');
    expect(readNumber(shapeMap, 'lastEditedAtMs', -1)).toBeGreaterThanOrEqual(
      beforeMs,
    );
    // createdBy / createdAtMs are immutable.
    expect(readString(shapeMap, 'createdBy', '')).toBe('author-A');
  });

  it('clamps colorSlot on update', () => {
    const { doc, shapeMap } = attach({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      colorSlot: 0,
      sessionId: 's',
    });
    doc.transact(() => {
      updateShape(shapeMap, { colorSlot: 12 }, 's');
    });
    expect(readNumber(shapeMap, 'colorSlot', -1)).toBe(7);
  });
});

/* ============================================================== *\
   Yjs round-trip — the load-bearing CRDT property
\* ============================================================== */

describe('Y.Map per shape round-trips through Y.applyUpdate', () => {
  it('a remote document sees an inserted rectangle with the same fields', () => {
    const { doc: docA, shapeId } = attach({
      kind: 'rectangle',
      x: 7,
      y: 11,
      w: 90,
      h: 60,
      colorSlot: 4,
      sessionId: 'session-A',
    });
    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);

    const rootB = docB.getMap(SHAPES_ROOT_KEY);
    const remote = rootB.get(shapeId);
    expect(remote).toBeInstanceOf(Y.Map);
    if (!(remote instanceof Y.Map)) return;
    expect(readShapeKind(remote)).toBe('rectangle');
    expect(readNumber(remote, 'x', -1)).toBe(7);
    expect(readNumber(remote, 'y', -1)).toBe(11);
    expect(readNumber(remote, 'w', -1)).toBe(90);
    expect(readNumber(remote, 'h', -1)).toBe(60);
    expect(readNumber(remote, 'colorSlot', -1)).toBe(4);
  });

  it("two users moving the same shape concurrently both survive (CRDT field-level merge)", () => {
    // Doc A and Doc B start with the same shape (synced from doc S).
    const { doc: docS, shapeId } = attach({
      kind: 'rectangle',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      colorSlot: 0,
      sessionId: 'origin',
    });
    const initial = Y.encodeStateAsUpdate(docS);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    Y.applyUpdate(docA, initial);
    Y.applyUpdate(docB, initial);

    // A moves x while B fills (changes colorSlot).
    const shapeA = docA.getMap(SHAPES_ROOT_KEY).get(shapeId) as Y.Map<unknown>;
    const shapeB = docB.getMap(SHAPES_ROOT_KEY).get(shapeId) as Y.Map<unknown>;
    docA.transact(() => {
      updateShape(shapeA, { x: 250 }, 'A');
    });
    docB.transact(() => {
      updateShape(shapeB, { colorSlot: 5 }, 'B');
    });

    // Cross-sync.
    const updateA = Y.encodeStateAsUpdate(docA);
    const updateB = Y.encodeStateAsUpdate(docB);
    Y.applyUpdate(docB, updateA);
    Y.applyUpdate(docA, updateB);

    for (const doc of [docA, docB]) {
      const map = doc.getMap(SHAPES_ROOT_KEY).get(shapeId) as Y.Map<unknown>;
      expect(readNumber(map, 'x', -1)).toBe(250); // A's edit survived
      expect(readNumber(map, 'colorSlot', -1)).toBe(5); // B's edit survived
    }
  });
});
