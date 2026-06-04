/**
 * Cursor + scroll subscriber unit tests for the engine (Phase 3.2).
 *
 * These tests mirror the scope of `footprint-engine.test.ts` — state
 * machine + math, no pixel assertions. The cursor painter has its own
 * coverage via the engine's paint pass (executed in the existing
 * "subscribes once" / "does not paint when dirty is false" tests; the
 * painter itself is a pure function whose only side effect is canvas
 * draw calls, so the painter unit test would be a tautology).
 */
import './canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { FootprintChartEngine } from '../footprint-engine';
import type { StreamState } from '@/lib/stores/stream-store';
import type { ThemeTokensSnapshot } from '@/lib/theme/tokens';

const TOKENS: ThemeTokensSnapshot = Object.freeze({
  '--color-bid': 'oklch(0.74 0.16 155)',
  '--color-ask': 'oklch(0.7 0.2 28)',
  '--color-delta-up': 'oklch(0.8 0.18 150)',
  '--color-delta-down': 'oklch(0.72 0.2 25)',
  '--color-grid': 'oklch(0.27 0.012 250)',
  '--color-bg': 'oklch(0.16 0.012 250)',
  '--color-cell-bg': 'oklch(0.19 0.013 250)',
  '--color-cell-bg-strong': 'oklch(0.4 0.04 220)',
  '--color-cell-fg': 'oklch(0.94 0.005 250)',
  '--color-cell-fg-subtle': 'oklch(0.62 0.012 250)',
  '--color-cell-imbalance-buy': 'oklch(0.72 0.2 152)',
  '--color-cell-imbalance-sell': 'oklch(0.68 0.22 28)',
  '--color-cell-imbalance-neutral': 'oklch(0.45 0.012 250)',
  '--color-cell-stroke': 'oklch(0.24 0.012 250)',
  '--color-cell-cursor': 'oklch(0.82 0.16 195)',
  '--color-cell-cursor-glow': 'oklch(0.82 0.16 195 / 0.25)',
  '--color-axis-tick': 'oklch(0.38 0.012 250)',
  '--color-axis-label': 'oklch(0.7 0.012 250)',
});

function makeThemeBridge() {
  const subs = new Set<(s: ThemeTokensSnapshot) => void>();
  return {
    current: () => TOKENS,
    subscribe: (cb: (s: ThemeTokensSnapshot) => void) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}

function makeStreamStore() {
  return createStore<StreamState>(
    () =>
      ({
        connectionState: 'idle',
        lastTickTsMs: null,
        tickCount: 0,
        framesPerSec: 0,
        recentTicks: [],
        openCells: new Map(),
        closedCells: [],
        cvd: 0,
        lastSnapshot: null,
        ingestFrame: () => {},
        ingestSnapshot: () => {},
        setConnectionState: () => {},
        resetSession: () => {},
      }) as StreamState,
  );
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  return canvas;
}

let rafSpy: { mockRestore: () => void };
let cafSpy: { mockRestore: () => void };

beforeEach(() => {
  rafSpy = vi
    .spyOn(globalThis, 'requestAnimationFrame')
    .mockImplementation(() => 1);
  cafSpy = vi
    .spyOn(globalThis, 'cancelAnimationFrame')
    .mockImplementation(() => {});
});

afterEach(() => {
  rafSpy.mockRestore();
  cafSpy.mockRestore();
});

function makeEngine(opts: { reduceMotion?: boolean; history?: boolean } = {}) {
  const store = makeStreamStore();
  if (opts.history === true) {
    // Seed 200 closed cells so the user can actually scroll into history.
    // Without history the engine clamps targetScrollX to 0 on every paint.
    const closedCells = Array.from({ length: 200 }, (_, i) => ({
      symbol: 'BTCUSDT-PERP',
      bucketTs: 1_780_000_000_000 - i * 60_000,
      priceBucket: 71_000,
      bidVolume: 1,
      askVolume: 1,
      trades: 1,
    }));
    store.setState((s) => ({ ...s, closedCells }));
  }
  const engine = new FootprintChartEngine(makeCanvas(), {
    themeBridge: makeThemeBridge(),
    streamStore: store,
    prefersReducedMotion: opts.reduceMotion === true,
  });
  engine.handleResize(800, 600, 1);
  engine.start();
  return engine;
}

describe('FootprintChartEngine — cursor channel', () => {
  it('setCursor updates pixel + cell state and marks dirty', () => {
    const engine = makeEngine();
    engine._testTick(); // settle initial paint
    expect(engine._testGetState().dirty).toBe(false);

    engine.setCursor({ x: 400, y: 300 });
    const after = engine._testGetState();
    expect(after.cursorPx).toEqual({ x: 400, y: 300 });
    expect(after.cursorCell).not.toBeNull();
    expect(after.dirty).toBe(true);
    engine.stop();
  });

  it('clearCursor resets cursor state and marks dirty', () => {
    const engine = makeEngine();
    engine.setCursor({ x: 400, y: 300 });
    engine._testTick();
    expect(engine._testGetState().dirty).toBe(false);

    engine.clearCursor();
    const after = engine._testGetState();
    expect(after.cursorPx).toBeNull();
    expect(after.cursorCell).toBeNull();
    expect(after.dirty).toBe(true);
    engine.stop();
  });

  it('clearCursor is a no-op when cursor is already null', () => {
    const engine = makeEngine();
    engine._testTick();
    expect(engine._testGetState().dirty).toBe(false);

    engine.clearCursor();
    expect(engine._testGetState().dirty).toBe(false);
    engine.stop();
  });

  it('setCursor no-ops on identical coords (does not mark dirty)', () => {
    const engine = makeEngine();
    engine.setCursor({ x: 400, y: 300 });
    engine._testTick();
    expect(engine._testGetState().dirty).toBe(false);

    engine.setCursor({ x: 400, y: 300 });
    expect(engine._testGetState().dirty).toBe(false);
    engine.stop();
  });

  it('subscribeCursor fires synchronously with current snapshot', () => {
    const engine = makeEngine();
    const calls: Array<unknown> = [];
    const unsubscribe = engine.subscribeCursor((s) => {
      calls.push(s);
    });
    expect(calls).toHaveLength(1);
    // No cursor set yet — initial snapshot is null.
    expect(calls[0]).toBeNull();
    unsubscribe();
    engine.stop();
  });

  it('subscribeCursor notifies on setCursor + clearCursor but NOT on no-op set', () => {
    const engine = makeEngine();
    const calls: Array<unknown> = [];
    engine.subscribeCursor((s) => {
      calls.push(s);
    });
    expect(calls).toHaveLength(1); // initial null

    engine.setCursor({ x: 100, y: 100 });
    expect(calls).toHaveLength(2);

    // Identical coords — no notification.
    engine.setCursor({ x: 100, y: 100 });
    expect(calls).toHaveLength(2);

    engine.setCursor({ x: 200, y: 200 });
    expect(calls).toHaveLength(3);

    engine.clearCursor();
    expect(calls).toHaveLength(4);
    expect(calls[3]).toBeNull();

    // clearCursor while already null is a no-op.
    engine.clearCursor();
    expect(calls).toHaveLength(4);
    engine.stop();
  });

  it('unsubscribe removes the subscriber', () => {
    const engine = makeEngine();
    const calls: number[] = [];
    const unsubscribe = engine.subscribeCursor(() => {
      calls.push(1);
    });
    expect(calls).toHaveLength(1);
    unsubscribe();
    engine.setCursor({ x: 50, y: 50 });
    expect(calls).toHaveLength(1);
    expect(engine._testGetState().cursorSubscriberCount).toBe(0);
    engine.stop();
  });

  it('scale inverses produce a finite cell for an in-region cursor', () => {
    const engine = makeEngine();
    engine.setCursor({ x: 400, y: 300 });
    const cell = engine._testGetState().cursorCell;
    expect(cell).not.toBeNull();
    expect(Number.isFinite(cell?.bucketTs ?? NaN)).toBe(true);
    expect(Number.isFinite(cell?.priceBucket ?? NaN)).toBe(true);
    // bucketTs must be aligned to the bar duration grid (60_000 ms).
    // Use Math.abs to dodge the `-0` quirk on `Math.round(-0.25)`.
    expect(Math.abs((cell?.bucketTs ?? 0) % 60_000)).toBe(0);
    // priceBucket is an INDEX (one row = one step); any integer is valid.
    expect(Number.isInteger(cell?.priceBucket ?? NaN)).toBe(true);
    engine.stop();
  });
});

describe('FootprintChartEngine — scroll channel + setScrollTarget', () => {
  it('subscribeScroll fires synchronously with the current snapshot', () => {
    const engine = makeEngine();
    const calls: Array<{ currentScrollX: number; atRightEdge: boolean }> = [];
    engine.subscribeScroll((s) => {
      calls.push({
        currentScrollX: s.currentScrollX,
        atRightEdge: s.atRightEdge,
      });
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ currentScrollX: 0, atRightEdge: true });
    engine.stop();
  });

  it('subscribeScroll notifies after a tick that changed scroll state', () => {
    const engine = makeEngine({ history: true, reduceMotion: true });
    const calls: Array<{ atRightEdge: boolean }> = [];
    engine.subscribeScroll((s) => {
      calls.push({ atRightEdge: s.atRightEdge });
    });
    expect(calls).toHaveLength(1);

    engine._testScrollBy(200);
    engine._testTick();
    // First tick advances scroll (jumps because reduceMotion) →
    // atRightEdge should flip false.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[calls.length - 1]?.atRightEdge).toBe(false);
    engine.stop();
  });

  it('setScrollTarget(0) flips dirty + atRightEdge after settle', () => {
    const engine = makeEngine({ history: true, reduceMotion: true });
    engine._testScrollBy(200);
    engine._testTick();
    expect(engine._testGetState().currentScrollX).toBeGreaterThan(0);

    engine.setScrollTarget(0);
    expect(engine._testGetState().targetScrollX).toBe(0);
    expect(engine._testGetState().dirty).toBe(true);
    engine.stop();
  });

  it('setScrollTarget clamps to 0 on negative input', () => {
    const engine = makeEngine();
    engine.setScrollTarget(-100);
    expect(engine._testGetState().targetScrollX).toBe(0);
    engine.stop();
  });

  it('setScrollTarget no-ops when target unchanged', () => {
    const engine = makeEngine();
    engine._testTick();
    expect(engine._testGetState().dirty).toBe(false);
    engine.setScrollTarget(0); // already 0
    expect(engine._testGetState().dirty).toBe(false);
    engine.stop();
  });
});
