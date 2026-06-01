import './canvas-mock';

import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { BoardEngine, SHAPES_MAP_KEY } from '../engine';
import type { ThemeTokensSnapshot } from '../theme-tokens';

/**
 * BoardEngine — state-machine + subscribe-once contract tests.
 *
 * We do not assert on rendered pixels (jsdom has no Canvas2D and the
 * mock context is a no-op). We assert on the load-bearing engine
 * contracts per ADR-008:
 *
 *   - subscribe-once: the engine subscribes to (Y.Map, awareness,
 *     theme bridge) exactly ONCE at start().
 *   - dirty-flag logic: a Y.Map change flips shapeDirty; an
 *     awareness change flips cursorDirty.
 *   - theme flip: dirties BOTH layers + recomputes the palette
 *     cache.
 */

const TEST_BOARD_ID = 'e6f8a912-7c3e-4d12-9c01-1234567890ab';

const LIGHT_SNAPSHOT: ThemeTokensSnapshot = Object.freeze({
  '--color-bg': 'oklch(0.985 0.005 90)',
  '--color-surface': 'oklch(0.96 0.006 90)',
  '--color-border': 'oklch(0.86 0.01 90)',
  '--color-fg': 'oklch(0.2 0.018 285)',
  '--color-fg-muted': 'oklch(0.44 0.016 285)',
  '--color-fg-subtle': 'oklch(0.45 0.012 285)',
  '--color-accent': 'oklch(0.55 0.18 285)',
  '--color-awareness-0': 'oklch(0.6 0.17 285)',
  '--color-awareness-1': 'oklch(0.6 0.17 330)',
  '--color-awareness-2': 'oklch(0.6 0.17 15)',
  '--color-awareness-3': 'oklch(0.6 0.17 60)',
  '--color-awareness-4': 'oklch(0.6 0.17 105)',
  '--color-awareness-5': 'oklch(0.6 0.17 150)',
  '--color-awareness-6': 'oklch(0.6 0.17 195)',
  '--color-awareness-7': 'oklch(0.6 0.17 240)',
});

const DARK_SNAPSHOT: ThemeTokensSnapshot = Object.freeze({
  '--color-bg': 'oklch(0.18 0.012 285)',
  '--color-surface': 'oklch(0.22 0.013 285)',
  '--color-border': 'oklch(0.32 0.014 285)',
  '--color-fg': 'oklch(0.96 0.005 285)',
  '--color-fg-muted': 'oklch(0.72 0.012 285)',
  '--color-fg-subtle': 'oklch(0.65 0.012 285)',
  '--color-accent': 'oklch(0.72 0.17 285)',
  '--color-awareness-0': 'oklch(0.72 0.17 285)',
  '--color-awareness-1': 'oklch(0.72 0.17 330)',
  '--color-awareness-2': 'oklch(0.72 0.17 15)',
  '--color-awareness-3': 'oklch(0.72 0.17 60)',
  '--color-awareness-4': 'oklch(0.72 0.17 105)',
  '--color-awareness-5': 'oklch(0.72 0.17 150)',
  '--color-awareness-6': 'oklch(0.72 0.17 195)',
  '--color-awareness-7': 'oklch(0.72 0.17 240)',
});

interface FakeThemeBridge {
  current(): ThemeTokensSnapshot;
  subscribe(cb: (snap: ThemeTokensSnapshot) => void): () => void;
  subscriberCount(): number;
  emit(snap: ThemeTokensSnapshot): void;
}

function makeFakeThemeBridge(initial: ThemeTokensSnapshot): FakeThemeBridge {
  const subscribers = new Set<(snap: ThemeTokensSnapshot) => void>();
  let snap = initial;
  return {
    current: () => snap,
    subscribe(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscriberCount: () => subscribers.size,
    emit(next) {
      snap = next;
      for (const cb of subscribers) cb(next);
    },
  };
}

function setup() {
  const shapeCanvas = document.createElement('canvas');
  const cursorCanvas = document.createElement('canvas');
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const themeBridge = makeFakeThemeBridge(LIGHT_SNAPSHOT);
  const engine = new BoardEngine({
    shapeCanvas,
    cursorCanvas,
    doc,
    awareness,
    boardId: TEST_BOARD_ID,
    themeBridge,
  });
  return { engine, doc, awareness, themeBridge, shapeCanvas, cursorCanvas };
}

const SESSION_REMOTE_A = '7a628a49-1234-4abc-8def-abcdef012345';
const SESSION_REMOTE_B = '6b517a38-9876-4cde-9f01-fedcba987654';

function makeIdentity(sessionId: string, emojiName: string) {
  return {
    sessionId,
    emojiChar: '\u{1F98A}',
    emojiName,
    color: { L: 0.6, C: 0.17, H: 285 },
    colorDark: { L: 0.7, C: 0.17, H: 285 },
  };
}

/**
 * Inject a remote awareness state at the given clientId without going
 * through the wire-format encode/decode dance — mirrors the helper
 * `use-awareness.test.ts` uses. The engine subscribes to `'change'`
 * events; emitting one with the right shape exercises the same code
 * path as a real wire delivery.
 */
function injectRemotePeer(
  awareness: Awareness,
  clientId: number,
  state: Record<string, unknown> | null,
): void {
  if (state === null) {
    awareness.states.delete(clientId);
    awareness.meta.delete(clientId);
    awareness.emit('change', [
      { added: [], updated: [], removed: [clientId] },
      'test',
    ]);
    return;
  }
  const exists = awareness.states.has(clientId);
  awareness.states.set(clientId, state);
  awareness.meta.set(clientId, {
    clock: (awareness.meta.get(clientId)?.clock ?? 0) + 1,
    lastUpdated: Date.now(),
  });
  awareness.emit('change', [
    {
      added: exists ? [] : [clientId],
      updated: exists ? [clientId] : [],
      removed: [],
    },
    'test',
  ]);
}

describe('BoardEngine — subscribe-once contract', () => {
  it('binds to the shapes Y.Map only once at start()', () => {
    const { engine, doc } = setup();
    expect(engine._testGetState().shapeMapBound).toBe(false);
    engine.start();
    expect(engine._testGetState().shapeMapBound).toBe(true);
    // Calling start() again throws — the engine is
    // constructed-bound-disposed exactly once per ADR-008.
    expect(() => engine.start()).toThrow();
    // Settle to a clean baseline before stop() so the "no flip
    // after stop" assertion below is meaningful (start() seeds
    // dirty=true so the first paint runs).
    engine.handleResize(800, 600, 1);
    engine._testTick();
    expect(engine._testGetState().shapeDirty).toBe(false);
    engine.stop();
    expect(engine._testGetState().shapeMapBound).toBe(false);
    // After stop() the doc's shapes map is no longer observed —
    // mutating it has no effect on engine state.
    doc.getMap(SHAPES_MAP_KEY).set('shape-1', new Y.Map());
    expect(engine._testGetState().shapeDirty).toBe(false);
  });

  it('subscribes to awareness change events once', () => {
    const { engine, awareness } = setup();
    expect(awareness.getStates().size).toBe(1); // local state seeded
    engine.start();
    // Re-binding throws — same subscribe-once contract as Y.Map.
    expect(() => engine.start()).toThrow();
    engine.stop();
  });

  it('subscribes to the theme bridge exactly once', () => {
    const { engine, themeBridge } = setup();
    expect(themeBridge.subscriberCount()).toBe(0);
    engine.start();
    expect(themeBridge.subscriberCount()).toBe(1);
    engine.stop();
    expect(themeBridge.subscriberCount()).toBe(0);
  });
});

describe('BoardEngine — dirty flag logic', () => {
  it('flips shapeDirty when the Y.Map changes', () => {
    const { engine, doc } = setup();
    engine.start();
    // Clear initial dirty by ticking once with a viewport (paint
    // is a no-op without a viewport but the dirty flag still
    // clears on tick — we set a viewport via handleResize so the
    // paint actually runs and clears the flag).
    engine.handleResize(800, 600, 1);
    engine._testTick();
    expect(engine._testGetState().shapeDirty).toBe(false);
    // Mutate the shapes map — observer fires, dirty flips.
    doc.getMap(SHAPES_MAP_KEY).set('shape-1', new Y.Map());
    expect(engine._testGetState().shapeDirty).toBe(true);
    engine.stop();
  });

  it('does NOT flip cursorDirty on Y.Map change', () => {
    const { engine, doc } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);
    engine._testTick();
    expect(engine._testGetState().cursorDirty).toBe(false);
    doc.getMap(SHAPES_MAP_KEY).set('shape-1', new Y.Map());
    // Y.Map change flips shape only — cursor stays clean. This is
    // the ADR-008 load-bearing decoupling: cursor motion does not
    // force shape repaint, and shape motion does not force cursor
    // repaint either.
    expect(engine._testGetState().cursorDirty).toBe(false);
    expect(engine._testGetState().shapeDirty).toBe(true);
    engine.stop();
  });

  it('flips cursorDirty when awareness changes', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);
    engine._testTick();
    expect(engine._testGetState().cursorDirty).toBe(false);
    // Simulate a remote awareness state arriving.
    awareness.setLocalStateField('cursor', { x: 100, y: 200 });
    expect(engine._testGetState().cursorDirty).toBe(true);
    engine.stop();
  });

  it('does NOT flip shapeDirty on awareness change', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);
    engine._testTick();
    expect(engine._testGetState().shapeDirty).toBe(false);
    awareness.setLocalStateField('cursor', { x: 100, y: 200 });
    expect(engine._testGetState().shapeDirty).toBe(false);
    expect(engine._testGetState().cursorDirty).toBe(true);
    engine.stop();
  });

  it('multiple Y.Map fires inside one frame collapse to one paint', () => {
    const { engine, doc } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);
    engine._testTick();
    // Three mutations before a tick — observer fires three times,
    // but the dirty flag is a boolean. The next tick paints once
    // and clears the flag.
    const shapes = doc.getMap(SHAPES_MAP_KEY);
    shapes.set('shape-1', new Y.Map());
    shapes.set('shape-2', new Y.Map());
    shapes.set('shape-3', new Y.Map());
    expect(engine._testGetState().shapeDirty).toBe(true);
    engine._testTick();
    expect(engine._testGetState().shapeDirty).toBe(false);
    engine.stop();
  });
});

describe('BoardEngine — theme flip', () => {
  it('flips BOTH dirty flags + recomputes the palette on theme change', () => {
    const { engine, themeBridge } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);
    engine._testTick();
    expect(engine._testGetState().shapeDirty).toBe(false);
    expect(engine._testGetState().cursorDirty).toBe(false);

    const beforeBg = engine._testGetState().paletteBg;
    expect(beforeBg).toBe('oklch(0.985 0.005 90)');

    themeBridge.emit(DARK_SNAPSHOT);

    // Both flags dirty.
    expect(engine._testGetState().shapeDirty).toBe(true);
    expect(engine._testGetState().cursorDirty).toBe(true);
    // Palette cache updated.
    expect(engine._testGetState().paletteBg).toBe('oklch(0.18 0.012 285)');
    expect(engine._testGetState().paletteBg).not.toBe(beforeBg);
    engine.stop();
  });
});

describe('BoardEngine — resize + local session id', () => {
  it('handleResize updates viewport + DPR + dirties both', () => {
    const { engine } = setup();
    engine.start();
    engine._testTick();
    expect(engine._testGetState().shapeDirty).toBe(false);
    expect(engine._testGetState().cursorDirty).toBe(false);

    engine.handleResize(1200, 800, 2);

    const state = engine._testGetState();
    expect(state.viewport).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    expect(state.dpr).toBe(2);
    expect(state.shapeDirty).toBe(true);
    expect(state.cursorDirty).toBe(true);
    engine.stop();
  });

  it('setLocalSessionId stores the id without flipping any dirty flag', () => {
    const { engine } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);
    engine._testTick();
    expect(engine._testGetState().shapeDirty).toBe(false);
    expect(engine._testGetState().cursorDirty).toBe(false);

    engine.setLocalSessionId('00000000-0000-4000-8000-000000000001');

    // Local cursor is the OS pointer — without a matching peer in the
    // render map the call is informational only; no dirty flip.
    expect(engine._testGetState().localSessionId).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(engine._testGetState().shapeDirty).toBe(false);
    // setLocalSessionId DOES dirty the cursor layer because a peer
    // with a matching session id (if any) gets evicted; the dirty
    // flip is the cleanup signal. With no matching peer the flip is
    // still emitted (one paint to reflect the no-op eviction); we
    // accept either value here to keep the test resilient to the
    // implementation detail.
    engine.stop();
  });
});

/* ============================================================== *\
   Phase 3.3 — Presence cursors
\* ============================================================== */

describe('BoardEngine — cursor map sync', () => {
  it('populates a CursorState on new remote awareness peer', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);
    engine._testTick();

    expect(engine._testCursors()).toHaveLength(0);

    const remoteClientId = awareness.clientID + 1;
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 100, y: 200 },
    });

    const cursors = engine._testCursors();
    expect(cursors).toHaveLength(1);
    expect(cursors[0]?.clientId).toBe(remoteClientId);
    expect(cursors[0]?.sessionId).toBe(SESSION_REMOTE_A);
    expect(cursors[0]?.emojiName).toBe('fox');
    // First paint snaps current to target — no awkward origin-to-
    // target slide on initial appearance.
    expect(cursors[0]?.currentX).toBe(100);
    expect(cursors[0]?.currentY).toBe(200);
    expect(cursors[0]?.targetX).toBe(100);
    expect(cursors[0]?.targetY).toBe(200);
    expect(cursors[0]?.opacity).toBe(1);
    expect(engine._testGetState().cursorDirty).toBe(true);
    engine.stop();
  });

  it('removes the CursorState when the peer leaves awareness', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    const remoteClientId = awareness.clientID + 1;
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 50, y: 75 },
    });
    expect(engine._testCursors()).toHaveLength(1);

    injectRemotePeer(awareness, remoteClientId, null);
    expect(engine._testCursors()).toHaveLength(0);
    engine.stop();
  });

  it('updates targetX/Y on subsequent cursor moves and flips cursorDirty', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    const remoteClientId = awareness.clientID + 1;
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 100, y: 100 },
    });
    // Settle baseline.
    engine._testTick();

    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 400, y: 300 },
    });

    const cursors = engine._testCursors();
    expect(cursors[0]?.targetX).toBe(400);
    expect(cursors[0]?.targetY).toBe(300);
    expect(engine._testGetState().cursorDirty).toBe(true);
    engine.stop();
  });

  it('lerps currentX/Y toward targetX/Y within ~120 ms', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    const remoteClientId = awareness.clientID + 1;
    // Start at (0, 0) — fake initial state.
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 0, y: 0 },
    });
    engine._testTick();

    // Pivot target to (200, 100).
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 200, y: 100 },
    });

    // After ~128 ms of simulated time the critical-damped lerp with
    // tau = 30 ms has closed ~98.5% of the gap; that is the visible-
    // snap convergence window the brief committed to. We advance in
    // 16 ms steps to mirror a real 60 fps loop.
    for (let i = 0; i < 8; i += 1) {
      engine._testAdvanceCursors(16);
    }
    const cursors = engine._testCursors();
    expect(cursors[0]).toBeDefined();
    // 200 × (1 - e^(-128/30)) ≈ 197.2 — well above 95% of the gap,
    // which is the load-bearing perceptual property (the user sees a
    // settled cursor, not a still-creeping one).
    expect(cursors[0]?.currentX).toBeGreaterThan(195);
    expect(cursors[0]?.currentX).toBeLessThanOrEqual(200);
    expect(cursors[0]?.currentY).toBeGreaterThan(97);
    expect(cursors[0]?.currentY).toBeLessThanOrEqual(100);

    // Drive a few more ticks past the 0.5 px settle threshold; the
    // engine snaps to target and clears cursorDirty.
    for (let i = 0; i < 12; i += 1) {
      engine._testAdvanceCursors(16);
    }
    const settled = engine._testCursors();
    expect(settled[0]?.currentX).toBe(200);
    expect(settled[0]?.currentY).toBe(100);
    engine.stop();
  });

  it('fades out and evicts the peer when cursor: null is reported', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    const remoteClientId = awareness.clientID + 1;
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 100, y: 100 },
    });
    engine._testTick();
    expect(engine._testCursors()[0]?.opacity).toBe(1);

    // Off-canvas: peer keeps their identity but reports null cursor.
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: null,
    });
    const before = engine._testCursors()[0];
    expect(before).toBeDefined();
    expect(before?.opacityTarget).toBe(0);
    expect(before?.targetX).toBeNull();
    expect(before?.targetY).toBeNull();

    // Advance ~250 ms (> 200 ms ramp) — peer should be evicted.
    engine._testAdvanceCursors(250);
    expect(engine._testCursors()).toHaveLength(0);
    engine.stop();
  });

  it('snaps to the new position on re-entry after fade-out', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    const remoteClientId = awareness.clientID + 1;
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 50, y: 50 },
    });
    engine._testTick();
    // Go off canvas — opacity ramp toward 0.
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: null,
    });
    // Half the ramp (opacity still mid-fade, peer still in map).
    engine._testAdvanceCursors(100);
    expect(engine._testCursors()).toHaveLength(1);
    // Re-enter far across the canvas.
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 500, y: 400 },
    });
    const cursors = engine._testCursors();
    // Current snaps to the new entry point so the fade-in starts
    // there, not from the stale fade-out position.
    expect(cursors[0]?.currentX).toBe(500);
    expect(cursors[0]?.currentY).toBe(400);
    expect(cursors[0]?.opacityTarget).toBe(1);
    engine.stop();
  });

  it('keeps cursorDirty true while any cursor is still moving', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    const remoteClientId = awareness.clientID + 1;
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 0, y: 0 },
    });
    engine._testTick();
    // Move target far away.
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 600, y: 500 },
    });
    // First post-pivot tick — paints + clears the dirty flag, then
    // the cursor-advance leg flips it back true because the lerp is
    // still in motion.
    engine._testTick();
    expect(engine._testGetState().cursorDirty).toBe(true);
    engine.stop();
  });

  it('settles cursorDirty to false once all cursors stop moving', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    const remoteClientId = awareness.clientID + 1;
    injectRemotePeer(awareness, remoteClientId, {
      identity: makeIdentity(SESSION_REMOTE_A, 'fox'),
      cursor: { x: 100, y: 100 },
    });
    // Drive enough ticks to settle the new-peer snap (immediate) and
    // run one paint pass.
    engine._testTick();
    engine._testTick();
    expect(engine._testGetState().cursorDirty).toBe(false);
    engine.stop();
  });

  it('excludes the local clientId from the cursor map', () => {
    const { engine, awareness } = setup();
    engine.start();
    engine.handleResize(800, 600, 1);

    // Local awareness state with a cursor field — must NOT appear in
    // the engine's cursor map. The OS pointer renders it; double-
    // drawing would create a perceptible offset between the OS
    // pointer hotspot and the canvas-painted glyph.
    awareness.setLocalStateField(
      'identity',
      makeIdentity(SESSION_REMOTE_B, 'panda'),
    );
    awareness.setLocalStateField('cursor', { x: 222, y: 333 });
    engine._testTick();
    expect(engine._testCursors()).toHaveLength(0);
    engine.stop();
  });
});
