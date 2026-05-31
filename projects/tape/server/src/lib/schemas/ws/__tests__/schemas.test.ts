/**
 * WS schema validation oracles — one parse-positive + one
 * parse-negative case per frame kind, plus envelope discriminator
 * routing assertions.
 *
 * This file is NOT the codec oracle (that's the bridge-side
 * `pnpm -F tape-server bridge:check` for Rust↔Bun round-trips per
 * Task 1.5b). These tests assert two things only:
 *
 *  1. Each committed fixture parses cleanly via the matching
 *     payload schema AND through the top-level envelope (so the
 *     discriminator routes to the right variant).
 *  2. A representative invalid mutation per fixture is rejected
 *     (we drop a required field) — i.e. the schemas are not
 *     accidentally lax.
 *
 * Runs via `pnpm -F tape-server test` (delegates to Bun's `bun
 * test`).
 */

import { describe, expect, test } from 'bun:test';

import cellCloseFixture from '../__fixtures__/cell-close.json';
import cellDeltaFixture from '../__fixtures__/cell-delta.json';
import controlHeartbeatFixture from '../__fixtures__/control-heartbeat.json';
import controlOverrunFixture from '../__fixtures__/control-overrun.json';
import snapshotFixture from '../__fixtures__/snapshot.json';
import tickFixture from '../__fixtures__/tick.json';

import {
  wsCellClosePayloadSchema,
  wsCellDeltaPayloadSchema,
  wsControlHeartbeatPayloadSchema,
  wsControlOverrunPayloadSchema,
  wsFrameSchema,
  wsSnapshotPayloadSchema,
  wsTickPayloadSchema,
} from '..';

/**
 * Helper: clone a fixture object and remove a nested field from
 * `payload`. Used to assert negative cases without mutating the
 * shared imported fixture (Bun caches JSON imports — mutating the
 * object would leak into subsequent tests).
 */
function withoutPayloadField(
  fixture: { topic: string; kind: string; payload: Record<string, unknown> },
  field: string,
): unknown {
  const { [field]: _dropped, ...rest } = fixture.payload;
  return { ...fixture, payload: rest };
}

describe('wsTickPayloadSchema', () => {
  test('accepts the canonical tick fixture', () => {
    const parsed = wsTickPayloadSchema.parse(tickFixture.payload);
    expect(parsed.aggressor).toBe('buy');
    expect(parsed.tsMs).toBe(1_748_534_400_000);
  });

  test('rejects a tick missing aggressor', () => {
    const broken = withoutPayloadField(tickFixture, 'aggressor');
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });
});

describe('wsCellDeltaPayloadSchema', () => {
  test('accepts the canonical cell.delta fixture', () => {
    const parsed = wsCellDeltaPayloadSchema.parse(cellDeltaFixture.payload);
    expect(parsed.bidVolumeDelta).toBeCloseTo(0.05);
    expect(parsed.tradesDelta).toBe(2);
  });

  test('rejects a delta missing tradesDelta', () => {
    const broken = withoutPayloadField(cellDeltaFixture, 'tradesDelta');
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });

  test('rejects a negative delta (v1 non-negative invariant)', () => {
    const broken = {
      ...cellDeltaFixture,
      payload: { ...cellDeltaFixture.payload, askVolumeDelta: -1 },
    };
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });
});

describe('wsCellClosePayloadSchema', () => {
  test('accepts the canonical cell.close fixture', () => {
    const parsed = wsCellClosePayloadSchema.parse(cellCloseFixture.payload);
    expect(parsed.symbol).toBe('BTCUSDT-PERP');
    expect(parsed.trades).toBe(41);
  });

  test('rejects a close missing symbol', () => {
    const broken = withoutPayloadField(cellCloseFixture, 'symbol');
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });

  test('has no overlapping totals-field names with cell.delta payload', () => {
    // Pulled from the ADR-005 + ADR-006 invariant — the totals
    // field tokens on the wire must differ between delta and close
    // so a hexdump reader can distinguish them without the
    // discriminator. Coordinate fields (bucketTs, priceBucket) are
    // identifiers, not totals — they may overlap.
    const closeTotals = ['bidVolume', 'askVolume', 'trades'];
    const deltaTotals = ['bidVolumeDelta', 'askVolumeDelta', 'tradesDelta'];
    for (const closeField of closeTotals) {
      expect(deltaTotals).not.toContain(closeField);
    }
  });
});

describe('wsSnapshotPayloadSchema', () => {
  test('accepts the canonical snapshot fixture', () => {
    const parsed = wsSnapshotPayloadSchema.parse(snapshotFixture.payload);
    expect(parsed.symbol).toBe('BTCUSDT-PERP');
    expect(parsed.cells.length).toBeGreaterThan(0);
    expect(parsed.cellsOpen.length).toBeGreaterThan(0);
    expect(parsed.recentTicks.length).toBeGreaterThan(0);
  });

  test('rejects a snapshot missing currentBarTs', () => {
    const broken = withoutPayloadField(snapshotFixture, 'currentBarTs');
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });

  test('rejects a snapshot whose nested cellsOpen has a negative delta', () => {
    const broken = {
      ...snapshotFixture,
      payload: {
        ...snapshotFixture.payload,
        cellsOpen: [
          {
            ...snapshotFixture.payload.cellsOpen[0],
            bidVolumeDelta: -2.5,
          },
        ],
      },
    };
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });
});

describe('wsControlOverrunPayloadSchema', () => {
  test('accepts the canonical control.overrun fixture', () => {
    const parsed = wsControlOverrunPayloadSchema.parse(
      controlOverrunFixture.payload,
    );
    expect(parsed.reason).toBe('queue.overflow');
    expect(parsed.droppedFrames).toBe(184);
  });

  test('rejects an unknown reason code', () => {
    const broken = {
      ...controlOverrunFixture,
      payload: { ...controlOverrunFixture.payload, reason: 'mystery.code' },
    };
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });
});

describe('wsControlHeartbeatPayloadSchema', () => {
  test('accepts the canonical control.heartbeat fixture', () => {
    const parsed = wsControlHeartbeatPayloadSchema.parse(
      controlHeartbeatFixture.payload,
    );
    expect(parsed.serverTsMs).toBe(1_748_534_400_000);
    expect(parsed.framesPerSecOut).toBeCloseTo(174.2);
  });

  test('rejects a heartbeat with a negative framesPerSecOut', () => {
    const broken = {
      ...controlHeartbeatFixture,
      payload: { ...controlHeartbeatFixture.payload, framesPerSecOut: -1 },
    };
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });
});

describe('wsFrameSchema (envelope discriminated union)', () => {
  test('routes the tick fixture to the tick variant', () => {
    const parsed = wsFrameSchema.parse(tickFixture);
    expect(parsed.kind).toBe('tick');
    if (parsed.kind === 'tick') {
      expect(parsed.payload.price).toBe(71_234.5);
    }
  });

  test('routes the cell.delta fixture to the cell.delta variant', () => {
    const parsed = wsFrameSchema.parse(cellDeltaFixture);
    expect(parsed.kind).toBe('cell.delta');
  });

  test('routes the cell.close fixture to the cell.close variant', () => {
    const parsed = wsFrameSchema.parse(cellCloseFixture);
    expect(parsed.kind).toBe('cell.close');
  });

  test('routes the snapshot fixture to the snapshot variant', () => {
    const parsed = wsFrameSchema.parse(snapshotFixture);
    expect(parsed.kind).toBe('snapshot');
  });

  test('routes the control.overrun fixture to the control.overrun variant', () => {
    const parsed = wsFrameSchema.parse(controlOverrunFixture);
    expect(parsed.kind).toBe('control.overrun');
  });

  test('routes the control.heartbeat fixture to the control.heartbeat variant', () => {
    const parsed = wsFrameSchema.parse(controlHeartbeatFixture);
    expect(parsed.kind).toBe('control.heartbeat');
  });

  test('rejects a frame whose topic does not match its kind', () => {
    // 'tick' must travel on 'ticks.btc' — pairing it with
    // 'cells.btc' violates the per-variant topic literal.
    const broken = { ...tickFixture, topic: 'cells.btc' };
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });

  test('rejects an unknown kind', () => {
    const broken = { ...tickFixture, kind: 'mystery.kind' };
    expect(() => wsFrameSchema.parse(broken)).toThrow();
  });
});
