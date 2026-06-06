import type { SnapshotFrame, TickFrame } from 'atlas-shared/schemas/ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TelemetryWsClient,
  type SocketLike,
  type WsConnectionStatus,
} from './ws-client';

/**
 * WS client frame handling + lifecycle against a MOCK socket (Task 4.2). This
 * stands in for the live-browser parts: it pins the contract handling — snapshot
 * dispatch, seq-gap -> snapshot.request, heartbeat liveness -> reconnect, and
 * the freeze-on-drop status flow — deterministically, no real socket.
 */

class MockSocket implements SocketLike {
  onopen: ((this: unknown, ev: unknown) => unknown) | null = null;
  onclose: ((this: unknown, ev: unknown) => unknown) | null = null;
  onerror: ((this: unknown, ev: unknown) => unknown) | null = null;
  onmessage: ((this: unknown, ev: { data: unknown }) => unknown) | null = null;
  readonly sent: string[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.call(this, {});
  }

  /** Test helper: simulate the server opening the connection. */
  open(): void {
    this.onopen?.call(this, {});
  }

  /** Test helper: deliver a server frame. */
  deliver(frame: unknown): void {
    this.onmessage?.call(this, { data: JSON.stringify(frame) });
  }
}

function snapshot(seq: number, serverTick: number): SnapshotFrame {
  return {
    t: 'snapshot',
    seq,
    protocolVersion: 1,
    serverTick,
    ts: Date.now(),
    vehicles: [],
    routes: [],
    stops: [],
    zones: [],
    telemetry: [],
  };
}

function tick(seq: number, serverTick: number): TickFrame {
  return { t: 'tick', seq, serverTick, ts: Date.now(), telemetry: [] };
}

describe('TelemetryWsClient', () => {
  let sockets: MockSocket[];
  let statuses: WsConnectionStatus[];
  let snapshots: number;
  let ticks: number;

  function makeClient(livenessTimeoutMs = 1000): TelemetryWsClient {
    sockets = [];
    statuses = [];
    snapshots = 0;
    ticks = 0;
    return new TelemetryWsClient({
      url: 'ws://test/ws',
      livenessTimeoutMs,
      minBackoffMs: 10,
      maxBackoffMs: 20,
      socketFactory: () => {
        const s = new MockSocket();
        sockets.push(s);
        return s;
      },
      callbacks: {
        onSnapshot: () => {
          snapshots += 1;
        },
        onTick: () => {
          ticks += 1;
        },
        onEvent: () => undefined,
        onHeartbeat: () => undefined,
        onStatus: (s) => statuses.push(s),
      },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens exactly one socket on connect and goes live on open', () => {
    const client = makeClient();
    client.connect();
    client.connect(); // idempotent — must not open a second socket
    expect(sockets).toHaveLength(1);

    const sock = sockets[0];
    if (!sock) throw new Error('no socket');
    sock.open();
    expect(client.getStatus()).toBe('live');
    expect(statuses).toContain('live');
    client.close();
  });

  it('dispatches snapshot and tick frames', () => {
    const client = makeClient();
    client.connect();
    const sock = sockets[0];
    if (!sock) throw new Error('no socket');
    sock.open();
    sock.deliver(snapshot(0, 100));
    sock.deliver(tick(1, 101));
    sock.deliver(tick(2, 102));
    expect(snapshots).toBe(1);
    expect(ticks).toBe(2);
    client.close();
  });

  it('requests a fresh snapshot on a detected seq gap', () => {
    const client = makeClient();
    client.connect();
    const sock = sockets[0];
    if (!sock) throw new Error('no socket');
    sock.open();
    sock.deliver(snapshot(0, 100));
    sock.deliver(tick(1, 101));
    // Skip seq 2 -> seq 3 is a gap.
    sock.deliver(tick(3, 103));
    expect(sock.sent).toContain(JSON.stringify({ t: 'snapshot.request' }));
    client.close();
  });

  it('treats a heartbeat-silence past the liveness window as dead and reconnects', () => {
    const client = makeClient(1000);
    client.connect();
    const first = sockets[0];
    if (!first) throw new Error('no socket');
    first.open();
    expect(client.getStatus()).toBe('live');

    // No frames for longer than the liveness window -> force-close + reconnect.
    vi.advanceTimersByTime(1001);
    expect(first.closed).toBe(true);
    expect(statuses).toContain('reconnecting');

    // The backoff timer fires and a SECOND socket opens.
    vi.advanceTimersByTime(50);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    client.close();
  });

  it('on a drop flips to reconnecting then re-opens with backoff', () => {
    const client = makeClient();
    client.connect();
    const first = sockets[0];
    if (!first) throw new Error('no socket');
    first.open();
    first.close(); // simulate a server-side drop
    expect(statuses).toContain('reconnecting');
    vi.advanceTimersByTime(50);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    client.close();
  });

  it('close() stops reconnection', () => {
    const client = makeClient();
    client.connect();
    const first = sockets[0];
    if (!first) throw new Error('no socket');
    first.open();
    client.close();
    const count = sockets.length;
    vi.advanceTimersByTime(1000);
    expect(sockets.length).toBe(count); // no further sockets opened
    expect(client.getStatus()).toBe('offline');
  });
});
