import { describe, expect, it } from 'vitest';
import { Packr } from 'msgpackr';

import {
  BACKOFF_CAP_MS,
  BACKOFF_DEFAULT_INITIAL_MS,
  BACKOFF_OVERRUN_INITIAL_MS,
  WS_CLOSE_CODE_OVERRUN,
  WSStreamClient,
  type WSConnectionState,
} from '../client';

/* -------------------------------------------------------------------------
 * Fake WS adapter. Minimal subset of the browser surface the client
 * touches: addEventListener, close, binaryType. The handle we expose
 * to tests has direct fire-* methods so we can step the lifecycle.
 * --------------------------------------------------------------------- */

interface FakeWebSocketHandle {
  url: string;
  binaryType: string;
  fireOpen: () => void;
  fireMessage: (data: ArrayBuffer | Blob | string) => void;
  fireClose: (code: number) => void;
  fireError: () => void;
  closedWith: { code: number; reason: string } | null;
}

type Listener = (event: unknown) => void;

function makeFakeWebSocketCtor(): {
  Ctor: typeof WebSocket;
  handles: FakeWebSocketHandle[];
} {
  const handles: FakeWebSocketHandle[] = [];

  interface Internals {
    url: string;
    binaryType: string;
    listeners: Record<string, Listener[]>;
    closedWith: { code: number; reason: string } | null;
  }

  function fire(internals: Internals, type: string, event: unknown): void {
    for (const cb of internals.listeners[type] ?? []) cb(event);
  }

  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    url: string;
    binaryType = 'arraybuffer';
    private internals: Internals;

    constructor(url: string) {
      this.url = url;
      const internals: Internals = {
        url,
        binaryType: 'arraybuffer',
        listeners: { open: [], message: [], close: [], error: [] },
        closedWith: null,
      };
      this.internals = internals;
      handles.push({
        url,
        get binaryType() {
          return internals.binaryType;
        },
        set binaryType(value: string) {
          internals.binaryType = value;
        },
        fireOpen: () => {
          fire(internals, 'open', {});
        },
        fireMessage: (data) => {
          fire(internals, 'message', { data });
        },
        fireClose: (code) => {
          fire(internals, 'close', { code });
        },
        fireError: () => {
          fire(internals, 'error', {});
        },
        get closedWith() {
          return internals.closedWith;
        },
      });
    }

    addEventListener(type: string, cb: Listener): void {
      (this.internals.listeners[type] ??= []).push(cb);
    }

    close(code = 1000, reason = ''): void {
      this.internals.closedWith = { code, reason };
      fire(this.internals, 'close', { code });
    }

    send(_data: unknown): void {
      void _data;
    }
  }
  return { Ctor: FakeWebSocket as unknown as typeof WebSocket, handles };
}

interface FakeScheduler {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  pendingMs: number[];
  fireAll: () => void;
}

function makeFakeScheduler(): FakeScheduler {
  interface Entry {
    cb: () => void;
    ms: number;
    cancelled: boolean;
  }
  const callbacks: Entry[] = [];
  return {
    pendingMs: [],
    setTimeout(cb, ms) {
      const entry: Entry = { cb, ms, cancelled: false };
      callbacks.push(entry);
      this.pendingMs.push(ms);
      return entry;
    },
    clearTimeout(handle) {
      (handle as Entry).cancelled = true;
    },
    fireAll() {
      const snapshot = callbacks.splice(0, callbacks.length);
      for (const entry of snapshot) {
        if (!entry.cancelled) entry.cb();
      }
    },
  };
}

interface Harness {
  client: WSStreamClient;
  handles: FakeWebSocketHandle[];
  scheduler: FakeScheduler;
  states: WSConnectionState[];
  frames: unknown[];
  snapshots: unknown[];
}

function makeHarness(): Harness {
  const states: WSConnectionState[] = [];
  const frames: unknown[] = [];
  const snapshots: unknown[] = [];
  const { Ctor, handles } = makeFakeWebSocketCtor();
  const scheduler = makeFakeScheduler();
  const client = new WSStreamClient({
    url: 'ws://test/ws/stream',
    onFrame: (frame) => {
      frames.push(frame);
    },
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
    },
    onStateChange: (state) => {
      states.push(state);
    },
    WebSocketCtor: Ctor,
    scheduler: {
      setTimeout: scheduler.setTimeout.bind(scheduler),
      clearTimeout: scheduler.clearTimeout.bind(scheduler),
    },
    random: () => 0.5, // 0.5 -> jitter = 0 (centered).
  });
  return { client, handles, scheduler, states, frames, snapshots };
}

const packr = new Packr({ useRecords: false });

function encode(value: unknown): ArrayBuffer {
  const bytes = packr.pack(value);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const VALID_TICK_FRAME = {
  topic: 'ticks.btc' as const,
  kind: 'tick' as const,
  payload: {
    tsMs: 1_780_000_000_000,
    price: 71_000.5,
    qty: 0.125,
    aggressor: 'buy' as const,
  },
};

const VALID_SNAPSHOT_FRAME = {
  topic: 'cells.btc' as const,
  kind: 'snapshot' as const,
  payload: {
    symbol: 'BTCUSDT-PERP',
    currentBarTs: 1_780_000_000_000,
    cells: [],
    cellsOpen: [],
    recentTicks: [],
  },
};

describe('WSStreamClient', () => {
  it('walks idle -> connecting -> connected on a healthy open', () => {
    const harness = makeHarness();
    harness.client.connect();
    expect(harness.states).toEqual(['connecting']);
    harness.handles[0]!.fireOpen();
    expect(harness.states).toEqual(['connecting', 'connected']);
    expect(harness.client.state).toBe('connected');
  });

  it('routes snapshot frames to onSnapshot and other kinds to onFrame', () => {
    const harness = makeHarness();
    harness.client.connect();
    harness.handles[0]!.fireOpen();
    harness.handles[0]!.fireMessage(encode(VALID_SNAPSHOT_FRAME));
    harness.handles[0]!.fireMessage(encode(VALID_TICK_FRAME));
    expect(harness.snapshots).toHaveLength(1);
    expect(harness.frames).toHaveLength(1);
    expect((harness.frames[0] as { kind: string }).kind).toBe('tick');
  });

  it('soft-fails on schema validation failure (logs + drops the frame, does not throw)', () => {
    // A producer-side regression must not crash the WS reader — the
    // socket stays open, the offending frame is dropped, and the next
    // valid frame still lands in onFrame. Errors surface via
    // console.error for dev visibility.
    const harness = makeHarness();
    harness.client.connect();
    harness.handles[0]!.fireOpen();
    expect(() => {
      harness.handles[0]!.fireMessage(
        encode({
          topic: 'ticks.btc',
          kind: 'tick',
          payload: { tsMs: 1, price: 'not-a-number', qty: 1, aggressor: 'buy' },
        }),
      );
    }).not.toThrow();
    expect(harness.frames).toHaveLength(0);
    expect(harness.client.state).toBe('connected');
    // A subsequent VALID frame still flows through.
    harness.handles[0]!.fireMessage(encode(VALID_TICK_FRAME));
    expect(harness.frames).toHaveLength(1);
  });

  it('uses the FAST backoff path on CloseEvent.code 4290', () => {
    const harness = makeHarness();
    harness.client.connect();
    harness.handles[0]!.fireOpen();
    harness.handles[0]!.fireClose(WS_CLOSE_CODE_OVERRUN);
    expect(harness.client.state).toBe('reconnecting');
    expect(harness.client.restartCount).toBe(1);
    // 0.5 random -> centered jitter -> the wait is exactly the base.
    expect(harness.scheduler.pendingMs).toContain(BACKOFF_OVERRUN_INITIAL_MS);
  });

  it('uses the SLOW backoff path on CloseEvent.code 1006', () => {
    const harness = makeHarness();
    harness.client.connect();
    harness.handles[0]!.fireOpen();
    harness.handles[0]!.fireClose(1006);
    expect(harness.client.state).toBe('reconnecting');
    expect(harness.scheduler.pendingMs).toContain(BACKOFF_DEFAULT_INITIAL_MS);
  });

  it('caps the reconnect wait at BACKOFF_CAP_MS under exponential growth', () => {
    const harness = makeHarness();
    harness.client.connect();
    // No fireOpen — we want a string of reconnect-only schedules with
    // no healthy-reset timer mixing into pendingMs.
    harness.handles[0]!.fireClose(1006);
    harness.scheduler.fireAll();
    expect(harness.handles).toHaveLength(2);
    for (let i = 1; i < 12; i++) {
      const last = harness.handles[harness.handles.length - 1]!;
      last.fireClose(1006);
      harness.scheduler.fireAll();
    }
    const max = Math.max(...harness.scheduler.pendingMs);
    expect(max).toBeLessThanOrEqual(BACKOFF_CAP_MS);
    expect(max).toBe(BACKOFF_CAP_MS);
  });

  it('does NOT reconnect after an explicit close(reason)', () => {
    const harness = makeHarness();
    harness.client.connect();
    // Snapshot the pendingMs at this point — connect schedules nothing.
    const baselineLength = harness.scheduler.pendingMs.length;
    expect(baselineLength).toBe(0);
    harness.handles[0]!.fireOpen();
    // fireOpen schedules ONE healthy-reset timer; record it.
    const afterOpenLength = harness.scheduler.pendingMs.length;
    expect(afterOpenLength).toBe(1);
    harness.client.close('explicit');
    expect(harness.client.state).toBe('idle');
    // close() must not schedule a reconnect.
    expect(harness.scheduler.pendingMs.length).toBe(afterOpenLength);
    // A late close event from the socket layer must not flip state back
    // and must not schedule a reconnect either.
    harness.handles[0]!.fireClose(1000);
    expect(harness.client.state).toBe('idle');
    expect(harness.scheduler.pendingMs.length).toBe(afterOpenLength);
  });

  it('drops non-binary frames (the server contract is msgpackr binary)', () => {
    // Same soft-fail policy as the schema-validation case — log + drop,
    // do not throw and tear the socket down.
    const harness = makeHarness();
    harness.client.connect();
    harness.handles[0]!.fireOpen();
    expect(() => {
      harness.handles[0]!.fireMessage('this should be bytes');
    }).not.toThrow();
    expect(harness.frames).toHaveLength(0);
    expect(harness.client.state).toBe('connected');
  });

  it('exposes restartCount and increments on every reconnect-triggering close', () => {
    const harness = makeHarness();
    harness.client.connect();
    harness.handles[0]!.fireOpen();
    harness.handles[0]!.fireClose(1006);
    harness.scheduler.fireAll();
    harness.handles[1]!.fireClose(1006);
    expect(harness.client.restartCount).toBe(2);
  });
});
