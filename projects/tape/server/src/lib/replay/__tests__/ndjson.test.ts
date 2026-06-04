/**
 * NDJSON streaming serialisation — Task 1.7 gate.
 *
 * DB-free: drives `ndjsonStream` with hand-authored async generators so
 * the serialisation, ordering, empty-stream, per-line validation, and
 * error-propagation behaviour is covered without Postgres. The real query
 * generators (`streamReplayCells` / `streamReplayTicks`) need a live DB
 * and are exercised by the manual integration run documented in the Task
 * 1.7 report (seed → stream → docker compose down).
 */

import { describe, expect, test } from 'bun:test';

import { ndjsonStream } from '../ndjson';
import { replayCellRowSchema, type ReplayCellRow } from '../../schemas/replay/cell';
import { replayTickRowSchema, type ReplayTickRow } from '../../schemas/replay/tick';

/** Drain a ReadableStream<Uint8Array> to a decoded string. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * Build an async generator yielding the given rows in order. No `await`
 * inside is intentional — it mimics the postgres-js cursor's async
 * iterable surface without a real async boundary.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function* gen<T>(rows: readonly T[]): AsyncGenerator<T, void, unknown> {
  for (const r of rows) yield r;
}

function cell(bucketTs: number, priceBucket: number): ReplayCellRow {
  return {
    symbol: 'BTCUSDT-PERP',
    bucketTs,
    priceBucket,
    bidVolume: 1.5,
    askVolume: 2.5,
    trades: 7,
    delta: 1, // ask - bid
  };
}

function tick(tsMs: number): ReplayTickRow {
  return { tsMs, price: 68_000.5, qty: 0.01, aggressor: 'buy' };
}

describe('ndjsonStream — cells', () => {
  test('serialises one JSON object per line with a trailing newline', async () => {
    const rows = [cell(60_000, 13_600), cell(60_000, 13_601)];
    const body = await drain(
      ndjsonStream<ReplayCellRow>(gen(rows), (r) =>
        replayCellRowSchema.parse(r),
      ),
    );
    const lines = body.split('\n');
    // Two rows + a trailing empty segment after the final '\n'.
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0]!)).toEqual(rows[0]);
    expect(JSON.parse(lines[1]!)).toEqual(rows[1]);
  });

  test('preserves row order (bucket_ts then price_bucket)', async () => {
    const rows = [
      cell(60_000, 13_600),
      cell(60_000, 13_601),
      cell(120_000, 13_590),
    ];
    const body = await drain(
      ndjsonStream<ReplayCellRow>(gen(rows), (r) =>
        replayCellRowSchema.parse(r),
      ),
    );
    const parsed = body
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as ReplayCellRow);
    expect(parsed.map((r) => [r.bucketTs, r.priceBucket])).toEqual([
      [60_000, 13_600],
      [60_000, 13_601],
      [120_000, 13_590],
    ]);
  });

  test('every emitted line validates against the per-line schema', async () => {
    const rows = [cell(60_000, 13_600), cell(60_000, 13_601)];
    const body = await drain(
      ndjsonStream<ReplayCellRow>(gen(rows), (r) =>
        replayCellRowSchema.parse(r),
      ),
    );
    for (const line of body.split('\n').filter((l) => l.length > 0)) {
      expect(() => replayCellRowSchema.parse(JSON.parse(line))).not.toThrow();
    }
  });

  test('an empty day streams an empty body (zero lines)', async () => {
    const body = await drain(
      ndjsonStream<ReplayCellRow>(gen([]), (r) =>
        replayCellRowSchema.parse(r),
      ),
    );
    expect(body).toBe('');
  });
});

describe('ndjsonStream — ticks', () => {
  test('serialises tick rows ordered by ts_ms', async () => {
    const rows = [tick(1_000), tick(1_050), tick(1_100)];
    const body = await drain(
      ndjsonStream<ReplayTickRow>(gen(rows), (r) =>
        replayTickRowSchema.parse(r),
      ),
    );
    const parsed = body
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as ReplayTickRow);
    expect(parsed.map((r) => r.tsMs)).toEqual([1_000, 1_050, 1_100]);
  });
});

/**
 * Read once and capture the thrown error (or null if it resolved).
 * Typed against the minimal `{ read }` surface so it accepts both the
 * Bun and the Node `stream/web` reader flavours (they differ on a
 * `readMany` method that this helper does not touch).
 */
async function readError(reader: {
  read(): Promise<unknown>;
}): Promise<Error | null> {
  try {
    await reader.read();
    return null;
  } catch (err) {
    return err as Error;
  }
}

describe('ndjsonStream — error propagation', () => {
  test('a row that fails validation errors the stream, not a clean close', async () => {
    // Bad row: negative bidVolume violates `.nonnegative()`.
    const bad = { ...cell(60_000, 13_600), bidVolume: -1 } as ReplayCellRow;
    const stream = ndjsonStream<ReplayCellRow>(gen([bad]), (r) =>
      replayCellRowSchema.parse(r),
    );
    const err = await readError(stream.getReader());
    expect(err).not.toBeNull();
  });

  test('a generator that throws mid-stream surfaces the error', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    async function* throwing(): AsyncGenerator<ReplayCellRow, void, unknown> {
      yield cell(60_000, 13_600);
      throw new Error('db connection dropped');
    }
    const stream = ndjsonStream<ReplayCellRow>(throwing(), (r) =>
      replayCellRowSchema.parse(r),
    );
    const reader = stream.getReader();
    // First pull yields the good row.
    const first = await reader.read();
    expect(first.done).toBe(false);
    // Second pull hits the throw → stream errors.
    const err = await readError(reader);
    expect(err?.message).toBe('db connection dropped');
  });
});
