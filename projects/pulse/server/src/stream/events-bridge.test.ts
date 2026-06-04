import { describe, expect, it } from 'vitest';

import type { AppConfigService } from '../config/app-config.service';
import type { SseEvent } from '../lib/schemas/events';
import { EventsBridgeService } from './events-bridge.service';

/**
 * EventsBridge parse / scope-filter / ring-buffer tests (Task 3.1, ADR-003).
 *
 * The bridge's `ingest()` is the validation boundary: anything that is not a
 * well-formed `sseEventSchema` envelope is dropped (never relayed), valid
 * envelopes are fanned into the RxJS subject AND retained per scope in the ring
 * buffer for `Last-Event-ID` replay. These tests drive `ingest()` directly with
 * raw JSON strings exactly as the Redis `message` handler would — no live Redis
 * needed (the dedicated subscriber is only opened in `onModuleInit`, which we do
 * not call here).
 */

// The bridge only reads `config.redisUrl` in onModuleInit, which these tests do
// not exercise — a minimal stub satisfies the constructor.
const stubConfig = { redisUrl: 'redis://unused' } as unknown as AppConfigService;

function makeBridge(): EventsBridgeService {
  return new EventsBridgeService(stubConfig);
}

const SCOPE_A = 'dashboard:owner-a';
const SCOPE_B = 'dashboard:owner-b';
const MON = '11111111-1111-1111-1111-111111111111';

function envelope(id: number, scope: string): SseEvent {
  return {
    id,
    type: 'check.result',
    ts: 1000 + id,
    scope,
    payload: { monitorId: MON, status: 'up', statusCode: 200, responseTimeMs: 30, checkedAt: '2026-06-03T00:00:00.000Z' },
  };
}

describe('EventsBridgeService.ingest — validation at the boundary', () => {
  it('fans a valid envelope into events$', () => {
    const bridge = makeBridge();
    const received: SseEvent[] = [];
    const sub = bridge.events$.subscribe((e) => {
      received.push(e);
    });

    bridge.ingest(JSON.stringify(envelope(1, SCOPE_A)));

    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe(1);
    expect(received[0]?.scope).toBe(SCOPE_A);
    sub.unsubscribe();
  });

  it('DROPS non-JSON messages (never throws, never relays)', () => {
    const bridge = makeBridge();
    const received: SseEvent[] = [];
    const sub = bridge.events$.subscribe((e) => {
      received.push(e);
    });

    expect(() => {
      bridge.ingest('not json {{{');
    }).not.toThrow();
    expect(received).toHaveLength(0);
    sub.unsubscribe();
  });

  it('DROPS a malformed envelope (unknown type / bad payload) at the schema boundary', () => {
    const bridge = makeBridge();
    const received: SseEvent[] = [];
    const sub = bridge.events$.subscribe((e) => {
      received.push(e);
    });

    bridge.ingest(JSON.stringify({ id: 1, type: 'bogus.event', ts: 1, scope: SCOPE_A, payload: {} }));
    bridge.ingest(JSON.stringify({ id: 2, type: 'check.result', ts: 2, scope: 'not-a-scope', payload: {} }));

    expect(received).toHaveLength(0);
    sub.unsubscribe();
  });
});

describe('EventsBridgeService — per-scope ring buffer replay (Last-Event-ID)', () => {
  it('replays only events newer than the cursor, oldest-first, for the right scope', () => {
    const bridge = makeBridge();
    bridge.ingest(JSON.stringify(envelope(1, SCOPE_A)));
    bridge.ingest(JSON.stringify(envelope(2, SCOPE_A)));
    bridge.ingest(JSON.stringify(envelope(3, SCOPE_A)));

    // Reconnect with Last-Event-ID: 1 -> replay 2 and 3.
    const replayed = bridge.replayAfter(SCOPE_A, 1);
    expect(replayed.map((e) => e.id)).toEqual([2, 3]);
  });

  it('isolates ring buffers by scope (a scope never sees another scope events)', () => {
    const bridge = makeBridge();
    bridge.ingest(JSON.stringify(envelope(1, SCOPE_A)));
    bridge.ingest(JSON.stringify(envelope(2, SCOPE_B)));

    expect(bridge.replayAfter(SCOPE_A, 0).map((e) => e.id)).toEqual([1]);
    expect(bridge.replayAfter(SCOPE_B, 0).map((e) => e.id)).toEqual([2]);
  });

  it('returns nothing for an unknown scope', () => {
    const bridge = makeBridge();
    bridge.ingest(JSON.stringify(envelope(1, SCOPE_A)));
    expect(bridge.replayAfter('dashboard:nobody', 0)).toEqual([]);
  });

  it('caps the ring at 256 events, dropping the oldest', () => {
    const bridge = makeBridge();
    for (let i = 1; i <= 300; i += 1) {
      bridge.ingest(JSON.stringify(envelope(i, SCOPE_A)));
    }
    // After 300 ingests the ring holds the most recent 256 (ids 45..300).
    const all = bridge.replayAfter(SCOPE_A, 0);
    expect(all).toHaveLength(256);
    expect(all[0]?.id).toBe(45);
    expect(all[all.length - 1]?.id).toBe(300);
  });
});
