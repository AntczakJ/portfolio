/**
 * Replay route — input-validation 400 contract + per-line schema — Task
 * 1.7 gate.
 *
 * The 400 paths are reachable WITHOUT a database: `computeReplayBounds` /
 * `computeTickWindow` run before any query, so an off-allowlist symbol, a
 * malformed date, or a malformed window short-circuits to a 400 JSON body
 * before `getSql()` is ever called. We drive the Elysia app's
 * `handle(Request)` directly (no listener, no socket) and assert status +
 * body shape. The 200-streaming path needs a live DB and is covered by
 * the manual integration run in the Task 1.7 report.
 */

import { describe, expect, test } from 'bun:test';

import { replayRoutes } from '../route';
import { replayCellRowSchema } from '../../schemas/replay/cell';
import { replayTickRowSchema } from '../../schemas/replay/tick';

const BASE = 'http://localhost';

async function get(path: string): Promise<Response> {
  return replayRoutes.handle(new Request(`${BASE}${path}`));
}

describe('GET /api/replay/:symbol/:date — validation 400s', () => {
  test('400 on an unknown symbol', async () => {
    const res = await get('/api/replay/ETH-PERP/2026-06-01');
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { field: string; message: string };
    };
    expect(body.error.field).toBe('symbol');
  });

  test('400 on a malformed date', async () => {
    const res = await get('/api/replay/BTC-PERP/2026-6-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { field: string } };
    expect(body.error.field).toBe('date');
  });

  test('400 on a non-real calendar day', async () => {
    const res = await get('/api/replay/BTC-PERP/2026-02-30');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { field: string } };
    expect(body.error.field).toBe('date');
  });

  test('400 carries a typed { error: { field, message } } body', async () => {
    const res = await get('/api/replay/NOPE/whatever');
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { field: string; message: string };
    };
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});

describe('GET /api/replay/:symbol/:date/ticks — validation 400s', () => {
  test('400 on an unknown symbol before touching the window', async () => {
    const res = await get('/api/replay/ETH-PERP/2026-06-01/ticks');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { field: string } };
    expect(body.error.field).toBe('symbol');
  });

  test('400 on a malformed window (inverted from > to)', async () => {
    const res = await get(
      '/api/replay/BTC-PERP/2026-06-01/ticks?from=5000000000000&to=1000000000000',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { field: string } };
    expect(body.error.field).toBe('window');
  });

  test('400 on a non-integer from', async () => {
    const res = await get(
      '/api/replay/BTC-PERP/2026-06-01/ticks?from=1.5&to=2000',
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { field: string } };
    expect(body.error.field).toBe('window');
  });
});

describe('replayCellRowSchema — per-line shape', () => {
  const good = {
    symbol: 'BTCUSDT-PERP',
    bucketTs: 1_748_534_400_000,
    priceBucket: 13_600,
    bidVolume: 1.25,
    askVolume: 3.75,
    trades: 12,
    delta: 2.5,
  };

  test('accepts a canonical replay cell row', () => {
    expect(() => replayCellRowSchema.parse(good)).not.toThrow();
  });

  test('accepts a negative delta (bid-heavy bar)', () => {
    expect(() =>
      replayCellRowSchema.parse({ ...good, bidVolume: 5, askVolume: 1, delta: -4 }),
    ).not.toThrow();
  });

  test('rejects a negative bidVolume', () => {
    expect(() => replayCellRowSchema.parse({ ...good, bidVolume: -1 })).toThrow();
  });

  test('rejects a missing delta (the projected field)', () => {
    const { delta: _drop, ...rest } = good;
    expect(() => replayCellRowSchema.parse(rest)).toThrow();
  });

  test('field names align with cell.close totals (no *Delta names)', () => {
    const parsed = replayCellRowSchema.parse(good);
    expect(parsed).toHaveProperty('bidVolume');
    expect(parsed).toHaveProperty('askVolume');
    expect(parsed).not.toHaveProperty('bidVolumeDelta');
    expect(parsed).not.toHaveProperty('askVolumeDelta');
  });
});

describe('replayTickRowSchema — per-line shape', () => {
  const good = {
    tsMs: 1_748_534_400_000,
    price: 68_000.5,
    qty: 0.01,
    aggressor: 'sell' as const,
  };

  test('accepts a canonical replay tick row', () => {
    expect(() => replayTickRowSchema.parse(good)).not.toThrow();
  });

  test('rejects an invalid aggressor value', () => {
    expect(() =>
      replayTickRowSchema.parse({ ...good, aggressor: 'maker' }),
    ).toThrow();
  });

  test('rejects a non-positive price', () => {
    expect(() => replayTickRowSchema.parse({ ...good, price: 0 })).toThrow();
  });
});
