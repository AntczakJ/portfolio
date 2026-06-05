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
  '--font-mono': "'JetBrains Mono', ui-monospace, monospace",
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
    cvd: 0,
    cvdSeries: [],
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

  it('attaches + paints the CVD sub-pane in the same rAF pass (3.2c)', () => {
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

    expect(engine._testGetState().cvdCanvasAttached).toBe(false);

    const cvdCanvas = makeCanvas();
    engine.attachCvdCanvas(cvdCanvas);
    engine.handleCvdResize(800, 96, 1);
    expect(engine._testGetState().cvdCanvasAttached).toBe(true);
    expect(engine._testGetState().cvdViewport).toEqual({
      x: 0,
      y: 0,
      w: 800,
      h: 96,
    });

    // Seed a CVD series so the pane has something to draw, then tick.
    // The paint pass should not throw with the canvas-mock 2D context.
    store.setState((state) => ({
      ...state,
      cvdSeries: [
        { bucketTs: 1_780_000_000_000, cvd: 5 },
        { bucketTs: 1_780_000_060_000, cvd: 12 },
      ],
    }));
    engine._testNotifyStoreChange();
    expect(() => {
      engine._testTick();
    }).not.toThrow();

    // Detach: the footprint keeps running, the CVD pane stops.
    engine.detachCvdCanvas();
    expect(engine._testGetState().cvdCanvasAttached).toBe(false);
    engine.stop();
  });

  it('idles the rAF loop when there is no pending work, re-arms on a store change', () => {
    // Drive a controllable rAF: capture each scheduled callback so the
    // test can decide when (and whether) the next frame fires. This is
    // the real loop behaviour the dirty-flag idle relies on — the global
    // beforeEach stub returns a constant handle and never invokes the
    // callback, so we override it locally here.
    const pending: Array<() => void> = [];
    rafSpy.mockRestore();
    const localRaf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        pending.push(() => {
          cb(0);
        });
        return pending.length;
      });
    const runFrame = (): boolean => {
      const next = pending.shift();
      if (next === undefined) return false;
      next();
      return true;
    };

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

    // start() woke the loop: exactly one frame is queued.
    expect(engine._testGetState().frameScheduled).toBe(true);
    expect(pending.length).toBe(1);

    // Run the initial paint frame. With nothing dirty and scroll settled,
    // the loop must NOT re-schedule — it sleeps.
    expect(runFrame()).toBe(true);
    expect(engine._testGetState().dirty).toBe(false);
    expect(engine._testGetState().frameScheduled).toBe(false);
    expect(pending.length).toBe(0);

    // Draining further does nothing — the loop is asleep.
    expect(runFrame()).toBe(false);

    // A store change wakes the loop: one frame is queued again.
    store.setState((state) => ({
      ...state,
      recentTicks: [
        ...state.recentTicks,
        { tsMs: Date.now(), price: 71_000, qty: 0.1, aggressor: 'buy' },
      ],
    }));
    expect(engine._testGetState().frameScheduled).toBe(true);
    expect(pending.length).toBe(1);

    // Run it; with no further change the loop idles again.
    expect(runFrame()).toBe(true);
    expect(engine._testGetState().frameScheduled).toBe(false);
    expect(pending.length).toBe(0);

    engine.stop();
    localRaf.mockRestore();
    // Re-install the constant stub the afterEach expects to restore.
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 1);
  });

  it('keeps the loop alive across frames while a scroll animation runs', () => {
    const pending: Array<() => void> = [];
    rafSpy.mockRestore();
    const localRaf = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        pending.push(() => {
          cb(0);
        });
        return pending.length;
      });
    const runFrame = (): boolean => {
      const next = pending.shift();
      if (next === undefined) return false;
      next();
      return true;
    };

    const bridge = makeThemeBridge();
    const store = makeStreamStore();
    const canvas = makeCanvas();
    const engine = new FootprintChartEngine(canvas, {
      themeBridge: bridge,
      streamStore: store,
      prefersReducedMotion: false, // smooth scroll => multi-frame animation
    });
    engine.handleResize(800, 600, 1);

    // Seed history so a scroll target is reachable.
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
    runFrame(); // initial paint, settles, idles

    // Kick a scroll: the smooth follow must keep re-scheduling frames
    // until it settles, NOT idle after one frame.
    engine._testScrollBy(200);
    expect(engine._testGetState().frameScheduled).toBe(true);
    let frames = 0;
    while (runFrame()) {
      frames += 1;
      if (frames > 200) break; // guard against an infinite loop on a bug
    }
    // The animation took more than one frame to settle, then idled.
    expect(frames).toBeGreaterThan(1);
    expect(engine._testGetState().frameScheduled).toBe(false);

    engine.stop();
    localRaf.mockRestore();
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 1);
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
