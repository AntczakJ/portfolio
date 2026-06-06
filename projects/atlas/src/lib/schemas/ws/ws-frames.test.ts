import { describe, expect, it } from 'vitest';

import {
  bboxSchema,
  clientFrameSchema,
  MAX_SEEK_TICK,
  PROTOCOL_VERSION,
  serverFrameSchema,
  simControlFrameSchema,
  type ClientFrame,
  type ServerFrame,
} from './index';

/**
 * WS frame contract tests (Task 8.1).
 *
 * The WebSocket frame schemas are the FE/BE integration boundary (conventions
 * section 5) AND the one named public input surface (AGENT_NOTES "Security
 * posture"): the gateway runtime-validates EVERY inbound control frame against
 * `clientFrameSchema` and drops anything that does not match. These tests pin
 * two invariants:
 *
 *   1. ROUND-TRIP — a valid frame survives `JSON.stringify` -> `JSON.parse` ->
 *      schema parse unchanged (the frames cross the wire as JSON, ADR-003).
 *   2. REJECT MALFORMED — the boundary rejects the attack/typo shapes that the
 *      Phase 7 review hardened against: the over-`MAX_SEEK_TICK` seek (the P0
 *      event-loop-DoS guard) and the inverted/degenerate bbox (the P2 fix), plus
 *      the ordinary wrong-shape and unknown-discriminator cases.
 *
 * The gateway already has live integration tests (`gateway.test.ts`); this is
 * the pure contract-level coverage of the schemas themselves, co-located in the
 * shared package that owns them.
 */

/** Parse a frame the way the gateway does: stringify -> parse -> safeParse. */
function overTheWire(
  schema: { safeParse: (v: unknown) => { success: boolean } },
  frame: unknown,
) {
  const wire = JSON.parse(JSON.stringify(frame)) as unknown;
  return schema.safeParse(wire);
}

describe('client -> server frames — round-trip', () => {
  const valid: ClientFrame[] = [
    { t: 'subscribe' },
    { t: 'subscribe', vehicleIds: ['truck-7', 'van-3'] },
    { t: 'subscribe', bbox: [-8.645, 41.135, -8.585, 41.165] },
    { t: 'subscribe', vehicleIds: ['truck-7'], bbox: [-8.645, 41.135, -8.585, 41.165] },
    { t: 'unsubscribe' },
    { t: 'snapshot.request' },
    { t: 'sim.control', action: 'pause' },
    { t: 'sim.control', action: 'resume' },
    { t: 'sim.control', action: 'setSpeed', multiplier: 4 },
    { t: 'sim.control', action: 'seek', tick: 120 },
    { t: 'sim.control', action: 'seek', tick: MAX_SEEK_TICK },
    { t: 'sim.control', action: 'setSpeed', multiplier: 16 },
  ];

  it.each(valid)('accepts a valid frame over the wire: %j', (frame) => {
    const result = overTheWire(clientFrameSchema, frame);
    expect(result.success).toBe(true);
  });

  it('preserves the parsed value byte-for-byte across the round trip', () => {
    const frame: ClientFrame = {
      t: 'subscribe',
      vehicleIds: ['truck-7'],
      bbox: [-8.645, 41.135, -8.585, 41.165],
    };
    const parsed = clientFrameSchema.parse(JSON.parse(JSON.stringify(frame)));
    expect(parsed).toEqual(frame);
  });
});

describe('client -> server frames — reject malformed (the input-surface guard)', () => {
  it('rejects a seek over MAX_SEEK_TICK (the P0 event-loop-DoS guard)', () => {
    const attack = { t: 'sim.control', action: 'seek', tick: 1_000_000_000 };
    expect(clientFrameSchema.safeParse(attack).success).toBe(false);
    // The exact cap is the boundary: cap+1 fails, cap passes.
    expect(
      simControlFrameSchema.safeParse({ t: 'sim.control', action: 'seek', tick: MAX_SEEK_TICK + 1 })
        .success,
    ).toBe(false);
    expect(
      simControlFrameSchema.safeParse({ t: 'sim.control', action: 'seek', tick: MAX_SEEK_TICK })
        .success,
    ).toBe(true);
  });

  it('rejects a negative or non-integer seek tick', () => {
    expect(
      simControlFrameSchema.safeParse({ t: 'sim.control', action: 'seek', tick: -1 }).success,
    ).toBe(false);
    expect(
      simControlFrameSchema.safeParse({ t: 'sim.control', action: 'seek', tick: 12.5 }).success,
    ).toBe(false);
  });

  it('rejects a setSpeed multiplier over the cap or non-positive', () => {
    expect(
      simControlFrameSchema.safeParse({ t: 'sim.control', action: 'setSpeed', multiplier: 17 })
        .success,
    ).toBe(false);
    expect(
      simControlFrameSchema.safeParse({ t: 'sim.control', action: 'setSpeed', multiplier: 0 })
        .success,
    ).toBe(false);
    expect(
      simControlFrameSchema.safeParse({ t: 'sim.control', action: 'setSpeed', multiplier: -2 })
        .success,
    ).toBe(false);
  });

  it('rejects an inverted bbox (west >= east) — the P2 boundary refine', () => {
    // east < west: would silently cull everything in the server-side filter.
    expect(bboxSchema.safeParse([-8.585, 41.135, -8.645, 41.165]).success).toBe(false);
    expect(
      clientFrameSchema.safeParse({ t: 'subscribe', bbox: [-8.585, 41.135, -8.645, 41.165] })
        .success,
    ).toBe(false);
  });

  it('rejects a degenerate bbox (south >= north)', () => {
    expect(bboxSchema.safeParse([-8.645, 41.165, -8.585, 41.135]).success).toBe(false);
    // A zero-area box (all equal) is also degenerate.
    expect(bboxSchema.safeParse([-8.6, 41.15, -8.6, 41.15]).success).toBe(false);
  });

  it('rejects bbox coordinates outside the WGS84 range', () => {
    expect(bboxSchema.safeParse([-200, 41.135, -8.585, 41.165]).success).toBe(false);
    expect(bboxSchema.safeParse([-8.645, -91, -8.585, 41.165]).success).toBe(false);
  });

  it('rejects an unknown discriminator and an unknown sim.control action', () => {
    expect(clientFrameSchema.safeParse({ t: 'nope' }).success).toBe(false);
    expect(
      clientFrameSchema.safeParse({ t: 'sim.control', action: 'self-destruct' }).success,
    ).toBe(false);
  });

  it('rejects a setSpeed missing its multiplier and a seek missing its tick', () => {
    expect(clientFrameSchema.safeParse({ t: 'sim.control', action: 'setSpeed' }).success).toBe(
      false,
    );
    expect(clientFrameSchema.safeParse({ t: 'sim.control', action: 'seek' }).success).toBe(false);
  });

  it('rejects non-object / non-frame inputs (what a non-JSON message would parse to)', () => {
    expect(clientFrameSchema.safeParse(null).success).toBe(false);
    expect(clientFrameSchema.safeParse('subscribe').success).toBe(false);
    expect(clientFrameSchema.safeParse(42).success).toBe(false);
    expect(clientFrameSchema.safeParse([]).success).toBe(false);
    expect(clientFrameSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty-string vehicleId in a subscribe', () => {
    expect(clientFrameSchema.safeParse({ t: 'subscribe', vehicleIds: [''] }).success).toBe(false);
  });
});

describe('server -> client frames — round-trip', () => {
  const telemetry = {
    vehicleId: 'truck-7',
    lat: 41.1496,
    lng: -8.6109,
    headingDeg: 92.5,
    speedMps: 11.4,
    routeId: 'route-downtown-loop',
    distanceAlongRouteM: 1347.21,
    progress: 0.42,
    status: 'en_route',
    nextStopId: 'stop-3',
    etaSeconds: 86,
    currentZoneId: null,
  } as const;

  const valid: ServerFrame[] = [
    {
      t: 'snapshot',
      seq: 0,
      protocolVersion: PROTOCOL_VERSION,
      serverTick: 138,
      ts: 1780777508000,
      vehicles: [],
      routes: [],
      stops: [],
      zones: [],
      telemetry: [telemetry],
    },
    {
      t: 'tick',
      seq: 7,
      serverTick: 139,
      ts: 1780777509000,
      telemetry: [telemetry],
    },
    {
      t: 'event',
      seq: 8,
      serverTick: 140,
      event: {
        id: 'evt-1',
        type: 'geofence.enter',
        vehicleId: 'truck-7',
        zoneId: 'zone-downtown',
        at: '2026-06-06T22:25:08.000Z',
        payload: { zoneId: 'zone-downtown', zoneName: 'Downtown' },
      },
    },
    {
      t: 'heartbeat',
      seq: 9,
      serverTick: 141,
      ts: 1780777510000,
    },
  ];

  it.each(valid)('accepts a valid server frame over the wire: t=%# ', (frame) => {
    expect(overTheWire(serverFrameSchema, frame).success).toBe(true);
  });

  it('rejects a snapshot carrying the wrong protocolVersion', () => {
    const result = serverFrameSchema.safeParse({
      ...valid[0],
      protocolVersion: 999,
    });
    expect(result.success).toBe(false);
  });

  it('rejects telemetry with an out-of-range heading or progress', () => {
    const bad = { ...telemetry, headingDeg: 540, progress: 2 };
    const result = serverFrameSchema.safeParse({
      t: 'tick',
      seq: 1,
      serverTick: 1,
      ts: 1,
      telemetry: [bad],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown server frame discriminator', () => {
    expect(serverFrameSchema.safeParse({ t: 'mystery', seq: 0 }).success).toBe(false);
  });
});
