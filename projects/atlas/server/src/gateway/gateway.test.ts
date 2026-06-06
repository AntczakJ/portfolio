import { describe, expect, it } from 'vitest';

import type { VehicleTelemetry } from 'atlas-shared/schemas';
import {
  clientFrameSchema,
  PROTOCOL_VERSION,
  serverFrameSchema,
} from 'atlas-shared/schemas/ws';

import type { EngineDefinitions } from '../engine/engine-service.js';
import {
  buildEventFrame,
  buildHeartbeatFrame,
  buildSnapshotFrame,
  buildTickFrame,
} from './frames.js';
import { TokenBucket } from './rate-limiter.js';
import { DEFAULT_SCOPE, filterTelemetry, inScope } from './scope.js';
import { Connection, type ConnectionOptions } from './connection.js';

/**
 * WS gateway unit/integration smoke (Task 4.1, ADR-003). Asserts the load-bearing
 * gateway invariants in isolation from a live socket:
 *
 *   - the outbound frame BUILDERS produce frames that pass the SHARED Zod
 *     contract (`atlas-shared/schemas/ws`) — the builders cannot drift from the
 *     FE/BE boundary without this failing;
 *   - the per-connection RATE LIMITER (token bucket) throttles + refills;
 *   - server-side SCOPING filters telemetry by vehicleIds + bbox;
 *   - the COALESCE-TO-LATEST backpressure buffer keeps the newest position per
 *     vehicle and never grows with the tick count (the ADR-003 rule);
 *   - inbound CLIENT frames validate / malformed ones are rejected.
 *
 * The full "one WS connection, fleet moving" E2E is Phase 8 (Task 8.2); this is
 * the gateway's frame-handling unit cover.
 */

function telem(id: string, lng: number, lat: number): VehicleTelemetry {
  return {
    vehicleId: id,
    lat,
    lng,
    headingDeg: 90,
    speedMps: 8,
    routeId: 'route-downtown-loop',
    distanceAlongRouteM: 120,
    progress: 0.25,
    status: 'en_route',
    nextStopId: 'stop-1',
    etaSeconds: 42,
    currentZoneId: null,
  };
}

const definitions: EngineDefinitions = {
  vehicles: [
    { id: 'truck-1', label: 'Truck 1', type: 'van', routeId: 'route-downtown-loop', baseSpeedMps: 8, status: 'en_route' },
  ],
  routes: [
    {
      id: 'route-downtown-loop',
      name: 'Downtown Loop',
      loopMode: 'loop',
      lengthM: 4000,
      geometry: { type: 'LineString', coordinates: [[-8.61, 41.15], [-8.60, 41.16]] },
    },
  ],
  stops: [
    {
      id: 'stop-1',
      routeId: 'route-downtown-loop',
      seq: 0,
      name: 'Depot',
      dwellSeconds: 10,
      point: { type: 'Point', coordinates: [-8.61, 41.15] },
    },
  ],
  zones: [
    {
      id: 'zone-depot',
      name: 'Depot',
      kind: 'depot',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-8.62, 41.14], [-8.59, 41.14], [-8.59, 41.17], [-8.62, 41.17], [-8.62, 41.14]]],
      },
    },
  ],
};

describe('frame builders — shared contract', () => {
  it('builds a snapshot frame that passes the shared schema', () => {
    const frame = buildSnapshotFrame({
      seq: 0,
      serverTick: 5,
      ts: 1_700_000_000_000,
      definitions,
      telemetry: [telem('truck-1', -8.605, 41.155)],
    });
    expect(frame.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(serverFrameSchema.safeParse(frame).success).toBe(true);
  });

  it('builds a tick frame that passes the shared schema', () => {
    const frame = buildTickFrame(3, 9, 1_700_000_000_000, [telem('truck-1', -8.605, 41.155)]);
    expect(frame.t).toBe('tick');
    expect(serverFrameSchema.safeParse(frame).success).toBe(true);
  });

  it('builds an event frame that passes the shared schema', () => {
    const frame = buildEventFrame(7, 12, {
      id: 'truck-1:12:geofence.enter:zone-depot',
      type: 'geofence.enter',
      vehicleId: 'truck-1',
      zoneId: 'zone-depot',
      at: new Date(1_700_000_000_000).toISOString(),
      payload: { zoneId: 'zone-depot', zoneName: 'Depot' },
    });
    expect(serverFrameSchema.safeParse(frame).success).toBe(true);
  });

  it('builds a heartbeat frame that passes the shared schema', () => {
    const frame = buildHeartbeatFrame(1, 20, 1_700_000_000_000);
    expect(serverFrameSchema.safeParse(frame).success).toBe(true);
  });
});

describe('rate limiter — token bucket', () => {
  it('allows up to the burst, then drops, then refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket({ ratePerSec: 5, burst: 3, now: () => now });
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    // Burst exhausted.
    expect(bucket.tryConsume()).toBe(false);
    // 1 second later: 5 tokens replenished (capped at burst).
    now = 1000;
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
  });
});

describe('subscription scope — server-side filtering', () => {
  it('whole-fleet default passes everything', () => {
    const all = [telem('a', -8.6, 41.15), telem('b', -8.7, 41.10)];
    expect(filterTelemetry(DEFAULT_SCOPE, all)).toHaveLength(2);
  });

  it('vehicleIds narrows to the allowlist', () => {
    const scope = { vehicleIds: new Set(['a']), bbox: null };
    const all = [telem('a', -8.6, 41.15), telem('b', -8.6, 41.15)];
    const out = filterTelemetry(scope, all);
    expect(out).toHaveLength(1);
    expect(out[0]?.vehicleId).toBe('a');
  });

  it('bbox culls off-screen vehicles', () => {
    const scope = { vehicleIds: null, bbox: [-8.62, 41.14, -8.59, 41.17] as [number, number, number, number] };
    const inside = telem('a', -8.6, 41.15);
    const outside = telem('b', -7.0, 41.15);
    expect(inScope(scope, inside)).toBe(true);
    expect(inScope(scope, outside)).toBe(false);
  });
});

function makeFakeSocket(bufferedAmount = 0): { sent: string[]; socket: FakeSocket } {
  const sent: string[] = [];
  const socket = new FakeSocket(sent, bufferedAmount);
  return { sent, socket };
}

/** A minimal stand-in for the ws WebSocket the Connection touches. */
class FakeSocket {
  readyState = 1; // OPEN
  bufferedAmount: number;
  private readonly sent: string[];
  constructor(sent: string[], bufferedAmount: number) {
    this.sent = sent;
    this.bufferedAmount = bufferedAmount;
  }
  send(data: string): void {
    this.sent.push(data);
  }
}

const connOpts: ConnectionOptions = { rate: { ratePerSec: 10, burst: 20 } };

describe('connection — coalesce-to-latest backpressure', () => {
  it('flushes immediately when the socket is not backed up', () => {
    const { socket } = makeFakeSocket(0);
    // The Connection only reads readyState/bufferedAmount/send; cast through unknown.
    const conn = new Connection('c1', socket as unknown as never, connOpts);
    const canFlush = conn.stageTick(1, 1000, [telem('a', -8.6, 41.15)]);
    expect(canFlush).toBe(true);
    const pending = conn.takePending();
    expect(pending?.telemetry).toHaveLength(1);
    // Buffer cleared after take.
    expect(conn.hasPendingTelemetry).toBe(false);
  });

  it('coalesces multiple ticks for the same vehicle to the LATEST, bounded by fleet size', () => {
    const { socket } = makeFakeSocket(2 << 20); // 2 MiB buffered -> backed up
    const conn = new Connection('c2', socket as unknown as never, connOpts);

    // Ten ticks for the same two vehicles while backed up: the buffer must NOT
    // grow with the tick count — it holds the latest per vehicle (2 entries).
    for (let t = 1; t <= 10; t += 1) {
      const canFlush = conn.stageTick(t, t * 1000, [
        { ...telem('a', -8.6, 41.15), distanceAlongRouteM: t * 100 },
        { ...telem('b', -8.6, 41.15), distanceAlongRouteM: t * 50 },
      ]);
      expect(canFlush).toBe(false); // held under backpressure
    }
    const pending = conn.takePending();
    expect(pending).not.toBeNull();
    expect(pending?.telemetry).toHaveLength(2); // coalesced, not 20
    // The flushed serverTick/ts are the NEWEST seen (no stale replay).
    expect(pending?.serverTick).toBe(10);
    expect(pending?.ts).toBe(10_000);
    const va = pending?.telemetry.find((x) => x.vehicleId === 'a');
    expect(va?.distanceAlongRouteM).toBe(1000); // tick 10, not an earlier one
  });

  it('assigns a monotonic seq', () => {
    const { socket } = makeFakeSocket(0);
    const conn = new Connection('c3', socket as unknown as never, connOpts);
    expect(conn.nextSeq()).toBe(0);
    expect(conn.nextSeq()).toBe(1);
    expect(conn.nextSeq()).toBe(2);
  });
});

describe('client frame validation — the input boundary', () => {
  it('accepts well-formed control frames', () => {
    expect(clientFrameSchema.safeParse({ t: 'subscribe', vehicleIds: ['a'] }).success).toBe(true);
    expect(clientFrameSchema.safeParse({ t: 'unsubscribe' }).success).toBe(true);
    expect(clientFrameSchema.safeParse({ t: 'snapshot.request' }).success).toBe(true);
    expect(clientFrameSchema.safeParse({ t: 'sim.control', action: 'pause' }).success).toBe(true);
    expect(
      clientFrameSchema.safeParse({ t: 'sim.control', action: 'setSpeed', multiplier: 4 }).success,
    ).toBe(true);
    expect(clientFrameSchema.safeParse({ t: 'sim.control', action: 'seek', tick: 100 }).success).toBe(true);
  });

  it('rejects malformed / abusive frames', () => {
    expect(clientFrameSchema.safeParse({ t: 'nope' }).success).toBe(false);
    expect(clientFrameSchema.safeParse({ t: 'sim.control', action: 'setSpeed', multiplier: 999 }).success).toBe(false);
    expect(clientFrameSchema.safeParse({ t: 'subscribe', bbox: [0, 0, 0] }).success).toBe(false);
    expect(clientFrameSchema.safeParse(null).success).toBe(false);
    expect(clientFrameSchema.safeParse('drop table').success).toBe(false);
  });
});
