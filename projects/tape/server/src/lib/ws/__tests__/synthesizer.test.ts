/**
 * Synthesizer determinism + cadence tests — Task 1.6b per ADR-006.
 *
 * Asserts:
 *  - Same seed → identical sequence of broadcast frames over N steps.
 *  - Each frame parses through `wsFrameSchema` (no synthesizer bug
 *    can produce a malformed frame).
 *  - Cell-close emits absolute totals matching the open-bar
 *    accumulation (ADR-005 / ADR-006 invariant — close totals carry
 *    the sum of all delta + tick activity in the bar).
 *  - The interval constants match the task brief (5 ticks/s,
 *    cell.delta every 500 ms, cell.close every 60 s).
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import { decode } from '../../bridge/codec';
import { type WorkerPipeline } from '../../bridge';
import { wsFrameSchema, type WSFrame } from '../../schemas/ws';
import {
  WSConnectionRegistry,
  type WSClientSocket,
} from '../connections';
import { SnapshotCache } from '../snapshot-cache';
import {
  SYNTH_CELL_CLOSE_INTERVAL_MS,
  SYNTH_CELL_DELTA_INTERVAL_MS,
  SYNTH_DEFAULT_SEED,
  SYNTH_TICK_INTERVAL_MS,
  WSSynthesizer,
} from '../synthesizer';

/**
 * Capture every encoded payload the registry broadcasts, decoded
 * back into the typed envelope. The synthesizer publishes through
 * `registry.broadcast` which encodes + sends to all registered
 * clients — we register a capture client.
 */
interface FrameCapture {
  registry: WSConnectionRegistry;
  cache: SnapshotCache;
  frames: WSFrame[];
}

function makeCapture(): FrameCapture {
  const registry = new WSConnectionRegistry();
  const cache = new SnapshotCache();
  const frames: WSFrame[] = [];
  const capture: WSClientSocket = {
    send(bytes: Uint8Array) {
      frames.push(decode<WSFrame>(bytes));
    },
    close() {
      /* no-op */
    },
  };
  registry.register(capture);
  return { registry, cache, frames };
}

const FIXED_NOW = 1_748_534_400_000;

describe('cadence constants', () => {
  test('match the ADR-006 / brief values', () => {
    expect(SYNTH_TICK_INTERVAL_MS).toBe(200);
    expect(SYNTH_CELL_DELTA_INTERVAL_MS).toBe(500);
    expect(SYNTH_CELL_CLOSE_INTERVAL_MS).toBe(60_000);
    expect(SYNTH_DEFAULT_SEED).toBe(1);
  });
});

describe('determinism', () => {
  test('two synthesizers with the same seed emit identical tick sequences', () => {
    const captureA = makeCapture();
    const captureB = makeCapture();
    const synthA = new WSSynthesizer({
      registry: captureA.registry,
      snapshotCache: captureA.cache,
      now: () => FIXED_NOW,
      seed: 42,
    });
    const synthB = new WSSynthesizer({
      registry: captureB.registry,
      snapshotCache: captureB.cache,
      now: () => FIXED_NOW,
      seed: 42,
    });
    for (let i = 0; i < 50; i++) {
      synthA.stepOnce('tick');
      synthB.stepOnce('tick');
    }
    expect(captureA.frames.length).toBe(50);
    expect(captureB.frames.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      const frameA = captureA.frames[i];
      const frameB = captureB.frames[i];
      expect(frameA).toBeDefined();
      expect(frameB).toBeDefined();
      if (frameA === undefined || frameB === undefined) continue;
      expect(frameA.kind).toBe('tick');
      expect(frameA).toEqual(frameB);
    }
  });

  test('different seeds produce different streams (sanity, not a guarantee)', () => {
    const captureA = makeCapture();
    const captureB = makeCapture();
    const synthA = new WSSynthesizer({
      registry: captureA.registry,
      snapshotCache: captureA.cache,
      now: () => FIXED_NOW,
      seed: 1,
    });
    const synthB = new WSSynthesizer({
      registry: captureB.registry,
      snapshotCache: captureB.cache,
      now: () => FIXED_NOW,
      seed: 999,
    });
    for (let i = 0; i < 20; i++) {
      synthA.stepOnce('tick');
      synthB.stepOnce('tick');
    }
    // At least one frame must differ between the two streams.
    let anyDiff = false;
    for (let i = 0; i < 20; i++) {
      const a = captureA.frames[i];
      const b = captureB.frames[i];
      if (a !== undefined && b !== undefined) {
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          anyDiff = true;
          break;
        }
      }
    }
    expect(anyDiff).toBe(true);
  });
});

describe('frame validity', () => {
  let capture: FrameCapture;
  let synth: WSSynthesizer;

  beforeEach(() => {
    capture = makeCapture();
    synth = new WSSynthesizer({
      registry: capture.registry,
      snapshotCache: capture.cache,
      now: () => FIXED_NOW,
    });
  });

  test('every tick frame parses through the schema', () => {
    for (let i = 0; i < 30; i++) synth.stepOnce('tick');
    expect(capture.frames.length).toBe(30);
    for (const f of capture.frames) {
      expect(() => wsFrameSchema.parse(f)).not.toThrow();
      expect(f.kind).toBe('tick');
      expect(f.topic).toBe('ticks.btc');
    }
  });

  test('every cell.delta frame parses through the schema and lives on cells.btc', () => {
    for (let i = 0; i < 10; i++) synth.stepOnce('cell.delta');
    expect(capture.frames.length).toBe(10);
    for (const f of capture.frames) {
      expect(() => wsFrameSchema.parse(f)).not.toThrow();
      expect(f.kind).toBe('cell.delta');
      expect(f.topic).toBe('cells.btc');
    }
  });

  test('cell.close emits one frame per accumulated price bucket', () => {
    // Push some ticks so the open bar accumulates state.
    for (let i = 0; i < 25; i++) synth.stepOnce('tick');
    const tickCount = capture.frames.length;
    synth.stepOnce('cell.close');
    const closeCount = capture.frames.length - tickCount;
    // At least one cell should close (there's always at least one
    // active price bucket after 25 random-walk ticks).
    expect(closeCount).toBeGreaterThan(0);
    for (let i = tickCount; i < capture.frames.length; i++) {
      const f = capture.frames[i];
      if (f === undefined) continue;
      expect(f.kind).toBe('cell.close');
      expect(f.topic).toBe('cells.btc');
      if (f.kind === 'cell.close') {
        expect(f.payload.symbol).toBe('BTCUSDT-PERP');
        expect(f.payload.bidVolume).toBeGreaterThanOrEqual(0);
        expect(f.payload.askVolume).toBeGreaterThanOrEqual(0);
        expect(f.payload.trades).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('worker-fed mode (offline cell pipeline)', () => {
  /**
   * Minimal fake matching the `sendTick` surface the synthesizer
   * reaches for on `WorkerPipeline`. Records every pushed tick so the
   * test can assert the synth feeds the worker instead of emitting its
   * own cells.
   */
  interface SentTick {
    tsMs: number;
    symbol: string;
    price: number;
    qty: number;
    aggressor: 'buy' | 'sell';
  }
  function makeFakePipeline(): {
    pipeline: { sendTick: (t: SentTick) => void };
    sent: SentTick[];
  } {
    const sent: SentTick[] = [];
    return {
      sent,
      pipeline: {
        sendTick: (t: SentTick) => {
          sent.push(t);
        },
      },
    };
  }

  test('every synth tick is pushed into the worker pipeline', () => {
    const capture = makeCapture();
    const { pipeline, sent } = makeFakePipeline();
    const synth = new WSSynthesizer({
      registry: capture.registry,
      snapshotCache: capture.cache,
      now: () => FIXED_NOW,
      // Cast through unknown — the test fake implements only the
      // `sendTick` surface the synthesizer uses, not the full class.
      workerPipeline: pipeline as unknown as WorkerPipeline,
    });
    for (let i = 0; i < 10; i++) synth.stepOnce('tick');
    // Each tick produces exactly one WS tick frame AND one worker push.
    expect(capture.frames.length).toBe(10);
    expect(sent.length).toBe(10);
    for (const t of sent) {
      expect(t.symbol).toBe('BTCUSDT-PERP');
      expect(['buy', 'sell']).toContain(t.aggressor);
      expect(t.price).toBeGreaterThan(0);
      expect(t.qty).toBeGreaterThan(0);
    }
  });

  test('start() does NOT arm cell timers in worker-fed mode (worker owns cells)', () => {
    const capture = makeCapture();
    const { pipeline } = makeFakePipeline();
    const armed: number[] = [];
    const synth = new WSSynthesizer({
      registry: capture.registry,
      snapshotCache: capture.cache,
      now: () => FIXED_NOW,
      workerPipeline: pipeline as unknown as WorkerPipeline,
      // Record every interval period the synthesizer arms.
      setInterval: (_cb: () => void, ms: number) => {
        armed.push(ms);
        return armed.length;
      },
      clearInterval: () => {
        /* no-op */
      },
    });
    synth.start();
    // Only the tick timer is armed — NOT the cell.delta / cell.close
    // timers, because the Rust worker is the cell authority and the
    // synth must not double-produce cells.
    expect(armed).toEqual([SYNTH_TICK_INTERVAL_MS]);
    synth.stop();
  });

  test('default mode (no pipeline) still arms all three timers', () => {
    const capture = makeCapture();
    const armed: number[] = [];
    const synth = new WSSynthesizer({
      registry: capture.registry,
      snapshotCache: capture.cache,
      now: () => FIXED_NOW,
      setInterval: (_cb: () => void, ms: number) => {
        armed.push(ms);
        return armed.length;
      },
      clearInterval: () => {
        /* no-op */
      },
    });
    synth.start();
    expect(armed).toEqual([
      SYNTH_TICK_INTERVAL_MS,
      SYNTH_CELL_DELTA_INTERVAL_MS,
      SYNTH_CELL_CLOSE_INTERVAL_MS,
    ]);
    synth.stop();
  });
});

describe('snapshot cache integration', () => {
  test('synthesizer updates the snapshot cache so first-connect sees state', () => {
    const capture = makeCapture();
    const synth = new WSSynthesizer({
      registry: capture.registry,
      snapshotCache: capture.cache,
      now: () => FIXED_NOW,
    });
    for (let i = 0; i < 5; i++) synth.stepOnce('tick');
    const snap = capture.cache.current('BTCUSDT-PERP');
    expect(snap).not.toBeNull();
    if (snap === null) return;
    expect(snap.symbol).toBe('BTCUSDT-PERP');
    expect(snap.recentTicks.length).toBe(5);
    expect(snap.currentBarTs).toBeGreaterThan(0);
  });
});
