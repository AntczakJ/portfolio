/**
 * Engine unit tests. These exercise the state machine + scale math
 * without rendering pixels — jsdom's canvas is a no-op surface and
 * pixel-perfect assertions would be brittle. The painter modules
 * have their own unit coverage in sibling spec files.
 */
import './canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';

import { FootprintChartEngine } from '../footprint-engine';
import type { StreamState } from '@/lib/stores/stream-store';
import type { ThemeTokensSnapshot } from '@/lib/theme/tokens';

/** Hand-rolled minimal theme snapshot — matches the dark canonical block. */
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
  let current = TOKENS;
  const subs = new Set<(s: ThemeTokensSnapshot) => void>();
  return {
    current: () => current,
    subscribe: (cb: (s: ThemeTokensSnapshot) => void) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    /** test helper */
    _emit: (next: ThemeTokensSnapshot) => {
      current = next;
      for (const s of subs) s(next);
    },
    /** test helper */
    _subCount: () => subs.size,
  };
}

function makeStreamStore() {
  const initial: Partial<StreamState> = {
    connectionState: 'idle',
    lastTickTsMs: null,
    tickCount: 0,
    framesPerSec: 0,
    recentTicks: [],
    openCells: new Map(),
    closedCells: [],
    lastSnapshot: null,
  };
  return createStore<StreamState>(
    () =>
      ({
        ...initial,
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

// Holders so afterEach can restore. We use any-typed spies because the
// vi.spyOn return type for native globals is awkward with strict
// generics and the spies are just lifecycle scaffolding here.
let rafSpy: { mockRestore: () => void };
let cafSpy: { mockRestore: () => void };

beforeEach(() => {
  // Stub rAF so engine.start() does not actually loop in tests.
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

describe('FootprintChartEngine', () => {
  it('subscribes once to theme bridge + stream store on start()', () => {
    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const storeSubSpy = vi.spyOn(store, 'subscribe');
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: false,
    });
    engine.start();
    expect(bridge._subCount()).toBe(1);
    expect(storeSubSpy).toHaveBeenCalledTimes(1);
    engine.stop();
    expect(bridge._subCount()).toBe(0);
  });

  it('does not paint when dirty is false', () => {
    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: false,
    });
    engine.handleResize(800, 600, 1);
    engine.start();
    // Initial state is dirty=true; first _testTick should paint then
    // clear the flag. A subsequent tick with no changes is a no-op.
    engine._testTick();
    expect(engine._testGetState().dirty).toBe(false);
    engine._testTick();
    expect(engine._testGetState().dirty).toBe(false);
    engine.stop();
  });

  it('flips dirty on a theme change', () => {
    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: false,
    });
    engine.handleResize(800, 600, 1);
    engine.start();
    engine._testTick();
    expect(engine._testGetState().dirty).toBe(false);
    bridge._emit({ ...TOKENS, '--color-bg': 'oklch(0.99 0 0)' });
    expect(engine._testGetState().dirty).toBe(true);
    engine.stop();
  });

  it('tracks session-extreme trades across paints', () => {
    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: false,
    });
    engine.handleResize(800, 600, 1);
    engine.start();

    // Seed the store with one closed cell.
    store.setState((state) => ({
      ...state,
      closedCells: [
        {
          symbol: 'BTCUSDT-PERP',
          bucketTs: 1_780_000_000_000,
          priceBucket: 71_000,
          bidVolume: 5,
          askVolume: 3,
          trades: 12,
        },
      ],
    }));
    engine._testNotifyStoreChange();
    engine._testTick();
    expect(engine._testGetState().sessionMaxTrades).toBe(12);

    // A higher cell raises the extreme.
    store.setState((state) => ({
      ...state,
      closedCells: [
        ...state.closedCells,
        {
          symbol: 'BTCUSDT-PERP',
          bucketTs: 1_780_000_060_000,
          priceBucket: 71_005,
          bidVolume: 6,
          askVolume: 6,
          trades: 30,
        },
      ],
    }));
    engine._testNotifyStoreChange();
    engine._testTick();
    expect(engine._testGetState().sessionMaxTrades).toBe(30);

    // A lower one does NOT lower the extreme.
    store.setState((state) => ({
      ...state,
      closedCells: [
        ...state.closedCells,
        {
          symbol: 'BTCUSDT-PERP',
          bucketTs: 1_780_000_120_000,
          priceBucket: 71_010,
          bidVolume: 1,
          askVolume: 1,
          trades: 5,
        },
      ],
    }));
    engine._testNotifyStoreChange();
    engine._testTick();
    expect(engine._testGetState().sessionMaxTrades).toBe(30);
    engine.stop();
  });

  it('clamps scroll target to [0, history-overflow]', () => {
    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: true, // jump-to-target on settle
    });
    engine.handleResize(800, 600, 1);
    engine.start();

    // Try to scroll back further than the (empty) history allows.
    engine._testScrollBy(10_000);
    engine._testTick();
    // History is 1 bar; max scroll = max(0, 24 - region.w) = 0.
    expect(engine._testGetState().targetScrollX).toBe(0);

    // Negative scroll always clamps to 0.
    engine._testScrollBy(-500);
    engine._testTick();
    expect(engine._testGetState().targetScrollX).toBe(0);
    engine.stop();
  });

  it('auto-follows live right edge when scrollX === 0', () => {
    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: false,
    });
    engine.handleResize(800, 600, 1);
    engine.start();
    engine._testTick(); // initial paint
    expect(engine._testGetState().currentScrollX).toBe(0);
    expect(engine._testGetState().targetScrollX).toBe(0);

    // New tick arrives — scroll stays at 0, no manual snap needed.
    store.setState((state) => ({
      ...state,
      recentTicks: [
        ...state.recentTicks,
        {
          tsMs: Date.now(),
          price: 71_005,
          qty: 0.1,
          aggressor: 'buy',
        },
      ],
    }));
    engine._testNotifyStoreChange();
    engine._testTick();
    expect(engine._testGetState().currentScrollX).toBe(0);
    engine.stop();
  });

  it('does NOT auto-snap when user has scrolled away from live', () => {
    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: true,
    });
    engine.handleResize(800, 600, 1);

    // Seed history so the user can actually scroll.
    const closedCells = Array.from({ length: 100 }, (_, i) => ({
      symbol: 'BTCUSDT-PERP',
      bucketTs: 1_780_000_000_000 - i * 60_000,
      priceBucket: 71_000,
      bidVolume: 1,
      askVolume: 1,
      trades: 1,
    }));
    store.setState((state) => ({ ...state, closedCells }));

    engine.start();
    engine._testTick();
    engine._testScrollBy(120);
    engine._testTick();
    const offsetScroll = engine._testGetState().currentScrollX;
    expect(offsetScroll).toBeGreaterThan(0);

    // A new tick arrives. The scroll should not jump back to 0.
    store.setState((state) => ({
      ...state,
      recentTicks: [
        ...state.recentTicks,
        {
          tsMs: Date.now(),
          price: 71_005,
          qty: 0.1,
          aggressor: 'buy',
        },
      ],
    }));
    engine._testNotifyStoreChange();
    engine._testTick();
    expect(engine._testGetState().currentScrollX).toBeGreaterThan(0);
    engine.stop();
  });
});
