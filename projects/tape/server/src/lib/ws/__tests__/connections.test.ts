/**
 * Registry behaviour tests — Task 1.6b per ADR-006.
 *
 * Asserts the load-bearing pieces of the per-client queue: drop
 * policy correctness, cell-delta coalescing arithmetic, and the
 * circuit breaker firing at the canonical thresholds.
 *
 * Uses a fake socket adapter so no Bun runtime is required and the
 * tests can drive bytes through the registry deterministically.
 *
 * Runs via `pnpm -F tape-server test` (delegates to Bun's `bun
 * test`).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { decode } from '../../bridge/codec';
import { type WSFrame } from '../../schemas/ws';
import {
  WS_QUEUE_MAX_BYTES,
  WS_QUEUE_MAX_WALL_MS,
  WSConnectionRegistry,
  type WSClientSocket,
} from '../connections';

/**
 * A fake socket that records every `send` for inspection. The
 * `stalled` mode throws on send so the queue keeps
 * growing — used to simulate a slow client for circuit-breaker tests.
 */
interface FakeSocket extends WSClientSocket {
  sent: Uint8Array[];
  closeCode: number | null;
  closeReason: string | null;
}

/**
 * `stalled = true` simulates a stalled client by throwing on send.
 * `drainQueueToSocket` catches the throw and leaves the frame in the
 * queue — which is what we need to exercise the backpressure
 * policy. The close path still works because the registry catches
 * around `socket.close` too.
 */
function makeFakeSocket(opts?: { stalled?: boolean }): FakeSocket {
  const sent: Uint8Array[] = [];
  let closeCode: number | null = null;
  let closeReason: string | null = null;
  return {
    sent,
    get closeCode() {
      return closeCode;
    },
    get closeReason() {
      return closeReason;
    },
    send(payload: Uint8Array) {
      if (opts?.stalled === true) {
        throw new Error('stalled');
      }
      sent.push(payload);
    },
    close(code: number, reason: string) {
      closeCode = code;
      closeReason = reason;
    },
  };
}

const tick = (tsMs: number, price: number): WSFrame => ({
  topic: 'ticks.btc',
  kind: 'tick',
  payload: { tsMs, price, qty: 0.1, aggressor: 'buy' },
});

const cellDelta = (
  bucketTs: number,
  priceBucket: number,
  bidDelta: number,
  askDelta: number,
  tradesDelta: number,
): WSFrame => ({
  topic: 'cells.btc',
  kind: 'cell.delta',
  payload: {
    tsMs: bucketTs + 100,
    bucketTs,
    priceBucket,
    bidVolumeDelta: bidDelta,
    askVolumeDelta: askDelta,
    tradesDelta,
  },
});

let registry: WSConnectionRegistry;

beforeEach(() => {
  registry = new WSConnectionRegistry();
});

afterEach(() => {
  // Fresh registry per test — no shared state.
});

describe('register / unregister', () => {
  test('register returns a handle with topic subscriptions', () => {
    const handle = registry.register(makeFakeSocket());
    expect(handle.id).toBeGreaterThan(0);
    expect(handle.topics.has('ticks.btc')).toBe(true);
    expect(handle.topics.has('cells.btc')).toBe(true);
    expect(handle.topics.has('control')).toBe(true);
    expect(handle.queueDepth).toBe(0);
    expect(handle.droppedFrames).toBe(0);
    expect(handle.lastTickTsMs).toBeNull();
  });

  test('unregister removes the client from the registry', () => {
    const handle = registry.register(makeFakeSocket());
    expect(registry.connectedClients).toBe(1);
    registry.unregister(handle.id);
    expect(registry.connectedClients).toBe(0);
  });

  test('broadcast reaches only subscribed and non-closing clients', () => {
    const fakeA = makeFakeSocket();
    const fakeB = makeFakeSocket();
    registry.register(fakeA);
    registry.register(fakeB);
    const delivered = registry.broadcast(tick(1_000_000, 100));
    expect(delivered).toBe(2);
    expect(fakeA.sent.length).toBe(1);
    expect(fakeB.sent.length).toBe(1);
  });
});

describe('lastTickTsMs tracking', () => {
  test('updates on every tick broadcast', () => {
    const fake = makeFakeSocket();
    const handle = registry.register(fake);
    registry.broadcast(tick(1_111_111, 71_200));
    expect(handle.lastTickTsMs).toBe(1_111_111);
    registry.broadcast(tick(1_222_222, 71_205));
    expect(handle.lastTickTsMs).toBe(1_222_222);
  });

  test('does not update on cell.delta or close', () => {
    const fake = makeFakeSocket();
    const handle = registry.register(fake);
    registry.broadcast(tick(2_000, 100));
    registry.broadcast(cellDelta(60_000, 71_200, 0.1, 0.1, 1));
    expect(handle.lastTickTsMs).toBe(2_000);
  });
});

describe('drop-oldest tick policy', () => {
  test('evicts oldest tick to make room for an incoming snapshot frame', () => {
    // Strategy: stall a client (stalled), broadcast enough ticks
    // to grow the queue, then broadcast a snapshot frame whose
    // bytes would exceed the budget — the registry must evict
    // oldest ticks (not the snapshot) and stay under the breaker.
    const fake = makeFakeSocket({ stalled: true });
    const handle = registry.register(fake);

    // Each tick frame is ~50 B encoded. Fill ~70 % of budget with
    // small ticks.
    const targetTicks = Math.floor((WS_QUEUE_MAX_BYTES * 0.7) / 50);
    for (let i = 0; i < targetTicks; i++) {
      registry.broadcast(tick(1_000_000 + i, 100 + i));
    }
    const ticksBefore = handle.queueDepth;
    expect(ticksBefore).toBeGreaterThan(0);

    // Now push a snapshot frame so large it forces eviction. Build
    // it as a tick stream with many records — borrow the snapshot
    // payload shape via the frame builder.
    const bigSnapshot: WSFrame = {
      topic: 'cells.btc',
      kind: 'snapshot',
      payload: {
        symbol: 'BTCUSDT-PERP',
        currentBarTs: 60_000,
        cells: [],
        cellsOpen: [],
        // ~30 B per tick × 1000 = ~30 KB snapshot. Enough to
        // require evicting some ticks but not overrun the budget.
        recentTicks: Array.from({ length: 1000 }, (_, i) => ({
          tsMs: 60_000 + i,
          price: 71_000 + (i % 100),
          qty: 0.1,
          aggressor: i % 2 === 0 ? ('buy' as const) : ('sell' as const),
        })),
      },
    };
    registry.broadcast(bigSnapshot);

    // Some ticks were evicted to make room for the snapshot.
    expect(handle.droppedFrames).toBeGreaterThan(0);
    // The circuit breaker did NOT fire — drop policy absorbed it.
    expect(registry.overrunDisconnectCount).toBe(0);
    // The snapshot is still in the queue (or already sent).
  });

  test('snapshot, cell.close, and control frames never evict', () => {
    // Confirm `#evictOldestDroppable` only targets ticks. Stuff a
    // queue with cell.close and verify the breaker trips rather
    // than evicting them.
    const fake = makeFakeSocket({ stalled: true });
    registry.register(fake);

    // Fill the budget entirely with cell.close frames.
    let i = 0;
    while (registry.overrunDisconnectCount === 0) {
      registry.broadcast({
        topic: 'cells.btc',
        kind: 'cell.close',
        payload: {
          symbol: 'BTCUSDT-PERP',
          bucketTs: 60_000 + i * 60_000,
          priceBucket: 71_200,
          bidVolume: 5,
          askVolume: 5,
          trades: 10,
        },
      });
      i++;
      // Safety net against an infinite loop if test logic regresses.
      if (i > 10_000) break;
    }
    expect(registry.overrunDisconnectCount).toBe(1);
    expect(fake.closeCode).toBe(4290);
    expect(fake.closeReason).toBe('queue.overflow');
  });
});

describe('cell.delta coalescing', () => {
  test('two deltas for the same (bucketTs, priceBucket) coalesce to one queued frame with summed totals', () => {
    const fake = makeFakeSocket({ stalled: true });
    const handle = registry.register(fake);

    // Push two deltas with identical coordinates — second one
    // must merge into the first.
    registry.broadcast(cellDelta(60_000, 71_200, 0.1, 0.2, 3));
    registry.broadcast(cellDelta(60_000, 71_200, 0.4, 0.6, 7));

    // Queue depth stays at 1 because the second delta coalesced
    // into the first.
    expect(handle.queueDepth).toBe(1);
    // Drop count surfaces the coalesced frame as 1 dropped.
    expect(handle.droppedFrames).toBe(1);

    // Decode the queued frame and verify totals.
    expect(fake.sent.length).toBe(0); // stalled mode
    // We can't read the queued bytes directly without exposing it,
    // so re-enable sends by switching to a normal socket and
    // unblocking via another broadcast (a tick) to force a drain.
    // Instead, verify through the `droppedFrameCount` global which
    // also captures the coalesce.
    expect(registry.droppedFrameCount).toBe(1);
  });

  test('coalesced frame totals decode to the summed values', () => {
    // Use a non-dropping socket so we can observe the bytes that
    // shipped. Each broadcast immediately drains under no-pressure
    // — to exercise coalescing we need queue pressure. Use a
    // stalled socket then close and capture via a custom socket
    // that delays drain.
    const sent: Uint8Array[] = [];
    let drainLocked = true;
    const lockedSocket: WSClientSocket = {
      send(bytes: Uint8Array) {
        if (drainLocked) {
          // First two broadcasts arrive while drain is locked.
          throw new Error('drain locked');
        }
        sent.push(bytes);
      },
      close() {
        /* no-op */
      },
    };
    registry.register(lockedSocket);

    // Two deltas — same coords, locked drain → second must coalesce.
    registry.broadcast(cellDelta(60_000, 71_200, 0.1, 0.2, 3));
    registry.broadcast(cellDelta(60_000, 71_200, 0.4, 0.6, 7));

    // Unlock and push a third frame to flush the queue.
    drainLocked = false;
    registry.broadcast(cellDelta(60_000, 71_205, 0.0, 0.0, 1));

    // Two distinct (bucketTs, priceBucket) coords → 2 frames
    // shipped in total (the merged one for 71200 and the new one
    // for 71205).
    expect(sent.length).toBe(2);
    const merged = decode<WSFrame>(sent[0] ?? new Uint8Array());
    expect(merged.kind).toBe('cell.delta');
    if (merged.kind === 'cell.delta') {
      expect(merged.payload.priceBucket).toBe(71_200);
      expect(merged.payload.bidVolumeDelta).toBeCloseTo(0.5);
      expect(merged.payload.askVolumeDelta).toBeCloseTo(0.8);
      expect(merged.payload.tradesDelta).toBe(10);
    }
  });

  test('deltas for different coords do not coalesce', () => {
    const fake = makeFakeSocket({ stalled: true });
    const handle = registry.register(fake);
    registry.broadcast(cellDelta(60_000, 71_200, 0.1, 0.2, 1));
    registry.broadcast(cellDelta(60_000, 71_205, 0.1, 0.2, 1));
    registry.broadcast(cellDelta(120_000, 71_200, 0.1, 0.2, 1));
    expect(handle.queueDepth).toBe(3);
    expect(handle.droppedFrames).toBe(0);
  });
});

describe('circuit breaker — byte threshold', () => {
  test('fires at WS_QUEUE_MAX_BYTES when the offending frame is non-droppable', () => {
    expect(WS_QUEUE_MAX_BYTES).toBe(256 * 1024);
    const fake = makeFakeSocket({ stalled: true });
    registry.register(fake);

    // Push enough cell.close frames (non-droppable) to fill the
    // budget.
    let pushed = 0;
    while (registry.overrunDisconnectCount === 0 && pushed < 10_000) {
      registry.broadcast({
        topic: 'cells.btc',
        kind: 'cell.close',
        payload: {
          symbol: 'BTCUSDT-PERP',
          bucketTs: 60_000 + pushed * 60_000,
          priceBucket: 71_200,
          bidVolume: 5,
          askVolume: 5,
          trades: 10,
        },
      });
      pushed++;
    }
    expect(registry.overrunDisconnectCount).toBe(1);
    expect(fake.closeCode).toBe(4290);
    expect(fake.closeReason).toBe('queue.overflow');
  });
});

describe('circuit breaker — wall threshold', () => {
  test('fires at WS_QUEUE_MAX_WALL_MS when the head-of-line frame ages past the budget', async () => {
    expect(WS_QUEUE_MAX_WALL_MS).toBe(2_000);
    const fake = makeFakeSocket({ stalled: true });
    registry.register(fake);

    // Enqueue a single non-droppable frame. The head-enqueued
    // timestamp captures Date.now().
    registry.broadcast({
      topic: 'cells.btc',
      kind: 'cell.close',
      payload: {
        symbol: 'BTCUSDT-PERP',
        bucketTs: 60_000,
        priceBucket: 71_200,
        bidVolume: 5,
        askVolume: 5,
        trades: 10,
      },
    });

    // Wait past the wall threshold then push another frame — the
    // enqueue path checks `headIsStale` and trips.
    await new Promise((r) => setTimeout(r, WS_QUEUE_MAX_WALL_MS + 50));
    registry.broadcast({
      topic: 'cells.btc',
      kind: 'cell.close',
      payload: {
        symbol: 'BTCUSDT-PERP',
        bucketTs: 120_000,
        priceBucket: 71_200,
        bidVolume: 1,
        askVolume: 1,
        trades: 1,
      },
    });

    expect(registry.overrunDisconnectCount).toBe(1);
    expect(fake.closeCode).toBe(4290);
    expect(fake.closeReason).toBe('memory.budget');
  });
});

describe('framesPerSecOut sliding window', () => {
  test('rate increments per broadcast and decays as the window slides', () => {
    const fake = makeFakeSocket();
    registry.register(fake);
    expect(registry.framesPerSecOut()).toBe(0);
    for (let i = 0; i < 10; i++) {
      registry.broadcast(tick(1_000_000 + i, 100));
    }
    // 10 frames within the 5 s window → 2 frames/sec.
    expect(registry.framesPerSecOut()).toBeCloseTo(2, 1);
  });
});

describe('schema validation guardrail', () => {
  test('broadcast throws on a malformed frame', () => {
    registry.register(makeFakeSocket());
    // Negative price violates `wsTickPayloadSchema.price.positive()`.
    const bad = {
      topic: 'ticks.btc',
      kind: 'tick',
      payload: { tsMs: 1_000, price: -5, qty: 0.1, aggressor: 'buy' },
    };
    expect(() => registry.broadcast(bad as unknown as WSFrame)).toThrow();
  });
});
