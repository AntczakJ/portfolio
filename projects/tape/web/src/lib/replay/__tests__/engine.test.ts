import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReplayEngine, type ReplayParsers } from '../engine';
import { useStreamStore } from '@/lib/stores/stream-store';
import type { ReplayCellRow, ReplayTickRow } from 'tape-server';

const DAY = '2026-06-04';
const DAY_START = Date.UTC(2026, 5, 4);

/** Pass-through parsers — the test feeds already-valid rows as JSON. */
const parsers: ReplayParsers = {
  parseCell: (value) => ({ ok: true, value: value as ReplayCellRow }),
  parseTick: (value) => ({ ok: true, value: value as ReplayTickRow }),
};

function ndjson(lines: object[]): Response {
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  return new Response(body, {
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

function cell(bucketTs: number, priceBucket: number, ask: number, bid: number) {
  return {
    symbol: 'BTCUSDT-PERP',
    bucketTs,
    priceBucket,
    bidVolume: bid,
    askVolume: ask,
    trades: 1,
    delta: ask - bid,
  };
}

/**
 * A controllable rAF/timeout scheduler. `flushFrame(now)` runs the one
 * pending frame callback with the supplied timestamp; timers fire
 * immediately for the tick-window debounce so the fetch resolves.
 */
function makeScheduler() {
  let frameCb: ((now: number) => void) | null = null;
  const timeouts = new Map<number, () => void>();
  let nextId = 1;
  return {
    scheduler: {
      requestFrame: (cb: (now: number) => void) => {
        frameCb = cb;
        return 1;
      },
      cancelFrame: () => {
        frameCb = null;
      },
      setTimeout: (cb: () => void) => {
        const id = nextId++;
        timeouts.set(id, cb);
        return id;
      },
      clearTimeout: (handle: unknown) => {
        timeouts.delete(handle as number);
      },
    },
    flushFrame(now: number) {
      const cb = frameCb;
      frameCb = null;
      cb?.(now);
    },
    flushTimers() {
      const cbs = [...timeouts.values()];
      timeouts.clear();
      for (const cb of cbs) cb();
    },
    get hasFrame() {
      return frameCb !== null;
    },
  };
}

describe('ReplayEngine — virtual-clock bar materialisation', () => {
  afterEach(() => {
    useStreamStore.getState().resetSession();
    vi.restoreAllMocks();
  });

  it('materialises bars only as the virtual clock crosses each boundary', async () => {
    // Three bars: 00:00, 00:01, 00:02 (absolute). Cursor is session-day
    // relative, so bar 0 closes at cursor 60_000, bar 1 at 120_000, etc.
    const cells = [
      cell(DAY_START + 0, 1, 5, 0), // bar 0, +5
      cell(DAY_START + 60_000, 1, 2, 0), // bar 1, +2
      cell(DAY_START + 120_000, 1, 0, 3), // bar 2, -3
    ];
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/ticks') ? ndjson([]) : ndjson(cells),
    ) as unknown as typeof fetch;

    const ctl = makeScheduler();
    const cursors: number[] = [];
    let now = 0;
    const engine = new ReplayEngine({
      apiUrl: 'http://x',
      symbol: 'BTCUSDT-PERP',
      streamStore: useStreamStore,
      parsers,
      prefersReducedMotion: false,
      getSpeedX: () => 30,
      onCursorChange: (c) => cursors.push(c),
      onLoadState: () => undefined,
      fetchImpl,
      now: () => now,
      scheduler: ctl.scheduler,
    });

    engine.enter(DAY, 0);
    // Let the streamed cells arrive + the stream-end re-emit run.
    await vi.waitFor(() => {
      expect(engine.loadState).toBe('ready');
    });
    // Cursor at 0 → no bar has closed yet.
    expect(useStreamStore.getState().closedCells).toHaveLength(0);

    // Advance the clock to 2 s wall-clock at 30x = 60_000 ms cursor → bar 0
    // closes.
    now = 2000;
    ctl.flushFrame(now);
    expect(engine.cursorMs).toBe(60_000);
    expect(useStreamStore.getState().closedCells).toHaveLength(1);
    expect(useStreamStore.getState().cvd).toBe(5);

    // Another 2 s → cursor 120_000 → bar 1 closes.
    now = 4000;
    ctl.flushFrame(now);
    expect(useStreamStore.getState().closedCells).toHaveLength(2);
    expect(useStreamStore.getState().cvd).toBe(7);

    // Another 2 s → cursor 180_000 → bar 2 closes.
    now = 6000;
    ctl.flushFrame(now);
    expect(useStreamStore.getState().closedCells).toHaveLength(3);
    expect(useStreamStore.getState().cvd).toBe(4);

    engine.exit();
  });

  it('seek rebuilds the chart from scratch up to the cursor', async () => {
    const cells = [
      cell(DAY_START + 0, 1, 5, 0),
      cell(DAY_START + 60_000, 1, 2, 0),
      cell(DAY_START + 120_000, 1, 4, 0),
    ];
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/ticks') ? ndjson([]) : ndjson(cells),
    ) as unknown as typeof fetch;

    const ctl = makeScheduler();
    const engine = new ReplayEngine({
      apiUrl: 'http://x',
      symbol: 'BTCUSDT-PERP',
      streamStore: useStreamStore,
      parsers,
      prefersReducedMotion: false,
      getSpeedX: () => 1,
      onCursorChange: () => undefined,
      onLoadState: () => undefined,
      fetchImpl,
      now: () => 0,
      scheduler: ctl.scheduler,
    });

    engine.enter(DAY, 0);
    await vi.waitFor(() => {
      expect(engine.loadState).toBe('ready');
    });
    engine.pause();

    // Seek to a cursor where bars 0 and 1 have closed (cursor >= 120_000).
    engine.seek(150_000);
    expect(useStreamStore.getState().closedCells).toHaveLength(2);

    // Seek BACK to before any bar closed — chart rebuilds empty.
    engine.seek(30_000);
    expect(useStreamStore.getState().closedCells).toHaveLength(0);
    expect(useStreamStore.getState().cvd).toBe(0);

    engine.exit();
  });

  it('reports empty load state for a dataless day', async () => {
    const fetchImpl = vi.fn(async () => ndjson([])) as unknown as typeof fetch;
    const ctl = makeScheduler();
    const engine = new ReplayEngine({
      apiUrl: 'http://x',
      symbol: 'BTCUSDT-PERP',
      streamStore: useStreamStore,
      parsers,
      prefersReducedMotion: false,
      getSpeedX: () => 1,
      onCursorChange: () => undefined,
      onLoadState: () => undefined,
      fetchImpl,
      now: () => 0,
      scheduler: ctl.scheduler,
    });
    engine.enter(DAY, 0);
    await vi.waitFor(() => {
      expect(engine.loadState).toBe('empty');
    });
    expect(useStreamStore.getState().closedCells).toHaveLength(0);
    engine.exit();
  });

  it('fetches the bounded tick window around the cursor (not the whole day)', async () => {
    const ticks = [
      { tsMs: DAY_START + 50_000, price: 71_000, qty: 0.1, aggressor: 'buy' },
      { tsMs: DAY_START + 55_000, price: 71_010, qty: 0.2, aggressor: 'sell' },
    ];
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requested.push(url);
      return url.includes('/ticks')
        ? ndjson(ticks)
        : ndjson([cell(DAY_START + 0, 1, 1, 0)]);
    }) as unknown as typeof fetch;

    const ctl = makeScheduler();
    const engine = new ReplayEngine({
      apiUrl: 'http://x',
      symbol: 'BTCUSDT-PERP',
      streamStore: useStreamStore,
      parsers,
      prefersReducedMotion: false,
      getSpeedX: () => 1,
      onCursorChange: () => undefined,
      onLoadState: () => undefined,
      fetchImpl,
      now: () => 0,
      scheduler: ctl.scheduler,
    });

    engine.enter(DAY, 60_000);
    engine.pause();
    // Resolve the initial tick-window fetch (enter fires it immediately).
    await vi.waitFor(() => {
      expect(requested.some((u) => u.includes('/ticks'))).toBe(true);
    });
    await vi.waitFor(() => {
      expect(useStreamStore.getState().recentTicks).toHaveLength(2);
    });

    const tickUrl = requested.find((u) => u.includes('/ticks'))!;
    const params = new URL(tickUrl).searchParams;
    const from = Number(params.get('from'));
    const to = Number(params.get('to'));
    // The window ends at the absolute cursor (dayStart + 60_000) and spans
    // the trailing 90 s, clamped to the day start.
    expect(to).toBe(DAY_START + 60_000);
    expect(to - from).toBeLessThanOrEqual(90_000);
    // Never the whole day.
    expect(to - from).toBeLessThan(86_400_000);

    engine.exit();
  });
});
