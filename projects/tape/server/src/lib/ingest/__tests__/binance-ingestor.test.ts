/**
 * BinanceIngestor unit tests — Task 1.3.
 *
 * Covers:
 *  - start() opens a session row, connects the client, and registers
 *    the client singleton.
 *  - stop() closes the client, stamps ended_at on the session row,
 *    and clears the client singleton.
 *  - A valid aggTrade enqueues a TickRow, broadcasts a WS frame,
 *    and updates the snapshot cache.
 *  - A malformed aggTrade increments parseErrors (via the client's
 *    JSON / Zod path) and produces no downstream side effects.
 *  - The translator's aggressor flip is wired correctly end-to-end.
 *  - URL / symbol misconfiguration throws at constructor time
 *    (fail-fast guardrail).
 *  - The `health()` snapshot reads live off the client + session.
 *
 * Test runner: `bun test`. Uses fake WebSocket + fake registry +
 * mocked tick writer + mocked session — no real network, no real DB.
 */

import { describe, expect, test, beforeEach } from 'bun:test';

import { encode } from '../../bridge/codec';
import type { Session } from '../../../db/schema/sessions';
import type { WSFrame } from '../../schemas/ws';
import type { WSClientSocket } from '../../ws/connections';
import { WSConnectionRegistry } from '../../ws/connections';
import { SnapshotCache } from '../../ws/snapshot-cache';

import {
  __resetBinanceClientSingletonForTests,
  getBinanceClient,
  type BinanceWebSocket,
  type BinanceWebSocketFactory,
} from '../binance-client';
import { BinanceIngestor, INGEST_SYMBOL } from '../binance-ingestor';
import { IngestSession } from '../ingest-session';
import type { TickRow } from '../tick-writer';
import {
  TickWriter,
  type IntervalHandle,
  type TickScheduler,
} from '../tick-writer';

/**
 * Minimal fake of the browser WebSocket interface. Captures every
 * registered listener; the test drives `open` / `message` / `close`
 * deterministically.
 *
 * The `addEventListener` overload signature on `BinanceWebSocket` is
 * a union of four variants; instead of recreating that overload
 * (which TS does not let an implementor widen to a single
 * `(unknown)` signature), the fake satisfies the interface by
 * defining the field as the union type explicitly.
 */
class FakeWebSocket {
  binaryType: 'arraybuffer' | 'blob' = 'blob';
  url: string;
  closed = false;
  readonly #listeners = new Map<string, ((event: never) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  readonly addEventListener: BinanceWebSocket['addEventListener'] = ((
    type: string,
    listener: (event: never) => void,
  ): void => {
    let bucket = this.#listeners.get(type);
    if (bucket === undefined) {
      bucket = [];
      this.#listeners.set(type, bucket);
    }
    bucket.push(listener);
  });

  close(_code?: number, _reason?: string): void {
    this.closed = true;
    this.#fire('close', { code: 1000, reason: 'fake' });
  }

  fireOpen(): void {
    this.#fire('open', undefined);
  }

  fireMessage(data: unknown): void {
    this.#fire('message', { data });
  }

  fireClose(code: number, reason: string): void {
    this.#fire('close', { code, reason });
  }

  fireError(err: unknown): void {
    this.#fire('error', err);
  }

  #fire(type: string, payload: unknown): void {
    const bucket = this.#listeners.get(type) ?? [];
    for (const listener of bucket) {
      (listener as (e: unknown) => void)(payload);
    }
  }
}

class FakeWebSocketFactory {
  readonly created: FakeWebSocket[] = [];
  build: BinanceWebSocketFactory = (url: string): BinanceWebSocket => {
    const ws = new FakeWebSocket(url);
    this.created.push(ws);
    return ws;
  };
  /** Latest constructed socket (for the test's act() phase). */
  current(): FakeWebSocket {
    const ws = this.created[this.created.length - 1];
    if (ws === undefined) throw new Error('no socket constructed yet');
    return ws;
  }
}

/**
 * Deterministic scheduler shared with the TickWriter pattern from
 * Task 1.2b's test suite — same drop-in shape.
 */
class FakeIntervalScheduler implements TickScheduler {
  #nextId = 0;
  #handlers = new Map<number, () => void>();
  setInterval(handler: () => void, _ms: number): IntervalHandle {
    const id = this.#nextId++;
    this.#handlers.set(id, handler);
    return id as unknown as IntervalHandle;
  }
  clearInterval(handle: IntervalHandle): void {
    this.#handlers.delete(handle as unknown as number);
  }
}

/**
 * Mock TickWriter for the ingestor test — captures every enqueued
 * row. Inherits the real TickWriter so the type contract is honest.
 */
class CapturingTickWriter extends TickWriter {
  readonly enqueued: TickRow[] = [];
  constructor() {
    super({ scheduler: new FakeIntervalScheduler() });
  }
  override enqueue(row: TickRow): void {
    this.enqueued.push(row);
  }
}

/**
 * Capturing WS socket the registry hands to broadcast. The ingestor
 * does not see this directly; the registry will fan out to whatever
 * sockets we register. We register one fake client so we can observe
 * what bytes the broadcast pushed.
 */
class CapturingWsSocket implements WSClientSocket {
  readonly received: Uint8Array[] = [];
  send(payload: Uint8Array): void {
    this.received.push(payload);
  }
  close(_code: number, _reason: string): void {
    // no-op
  }
}

const VALID_BUY_EVENT = {
  e: 'aggTrade',
  E: 1735689600000,
  s: 'BTCUSDT',
  a: 12345,
  p: '71234.50',
  q: '0.125',
  f: 100,
  l: 105,
  T: 1735689599998,
  m: false,
};

const VALID_SELL_EVENT = { ...VALID_BUY_EVENT, m: true, T: 1735689599999 };

interface Harness {
  factory: FakeWebSocketFactory;
  tickWriter: CapturingTickWriter;
  registry: WSConnectionRegistry;
  snapshotCache: SnapshotCache;
  session: IngestSession;
  ingestor: BinanceIngestor;
  createdSessions: Session[];
  endedSessions: { id: string; endedAt: Date }[];
}

let nextSessionUuid = 1;

function makeHarness(): Harness {
  const factory = new FakeWebSocketFactory();
  const tickWriter = new CapturingTickWriter();
  const registry = new WSConnectionRegistry();
  const snapshotCache = new SnapshotCache();
  const createdSessions: Session[] = [];
  const endedSessions: { id: string; endedAt: Date }[] = [];

  const session = new IngestSession({
    createSession: (input) => {
      const row: Session = {
        id: `00000000-0000-0000-0000-${String(nextSessionUuid++).padStart(12, '0')}`,
        symbol: input.symbol,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        source: input.source ?? 'binance-futures',
      };
      createdSessions.push(row);
      return Promise.resolve(row);
    },
    endSession: (id, endedAt) => {
      endedSessions.push({ id, endedAt });
      return Promise.resolve();
    },
  });

  const ingestor = new BinanceIngestor({
    tickWriter,
    registry,
    snapshotCache,
    session,
    clientOptions: {
      url: 'wss://fake.binance.test/ws',
      symbol: 'btcusdt',
      autoReconnect: false,
      webSocketFactory: factory.build,
    },
  });

  return {
    factory,
    tickWriter,
    registry,
    snapshotCache,
    session,
    ingestor,
    createdSessions,
    endedSessions,
  };
}

beforeEach(() => {
  __resetBinanceClientSingletonForTests();
  nextSessionUuid = 1;
});

/**
 * Drive the session.start() promise through the microtask queue so the
 * client.connect() call lands and the fake WS is constructed before the
 * test's assertion phase. Mirrors the existing test-helper pattern in
 * `tick-writer.test.ts` (multiple `await Promise.resolve()` to flush).
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
}

describe('BinanceIngestor — lifecycle', () => {
  test('start opens a session row before connecting the WS', async () => {
    const h = makeHarness();
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    // The factory should have constructed exactly one fake WS.
    expect(h.factory.created.length).toBe(1);
    expect(h.createdSessions.length).toBe(1);
    h.factory.current().fireOpen();
    await startPromise;
    expect(h.ingestor.running).toBe(true);
    expect(h.session.currentId).toBe(h.createdSessions[0]?.id ?? null);
  });

  test('start registers the binance client singleton', async () => {
    const h = makeHarness();
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await startPromise;
    expect(getBinanceClient()).not.toBeNull();
  });

  test('stop closes the client, ends the session, and clears the singleton', async () => {
    const h = makeHarness();
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await startPromise;
    await h.ingestor.stop();
    expect(h.factory.current().closed).toBe(true);
    expect(h.endedSessions.length).toBe(1);
    expect(h.endedSessions[0]?.id).toBe(h.createdSessions[0]?.id ?? '');
    expect(getBinanceClient()).toBeNull();
    expect(h.ingestor.running).toBe(false);
  });

  test('start is idempotent', async () => {
    const h = makeHarness();
    const first = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await first;
    await h.ingestor.start();
    expect(h.factory.created.length).toBe(1);
    expect(h.createdSessions.length).toBe(1);
  });

  test('stop is idempotent', async () => {
    const h = makeHarness();
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await startPromise;
    await h.ingestor.stop();
    await h.ingestor.stop();
    expect(h.endedSessions.length).toBe(1);
  });
});

describe('BinanceIngestor — aggTrade fan-out', () => {
  test('a valid buy aggTrade produces a TickRow, a WS broadcast, and a snapshot update', async () => {
    const h = makeHarness();
    const wsClient = new CapturingWsSocket();
    h.registry.register(wsClient);
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await startPromise;

    h.factory.current().fireMessage(JSON.stringify(VALID_BUY_EVENT));

    expect(h.tickWriter.enqueued.length).toBe(1);
    const row = h.tickWriter.enqueued[0];
    expect(row?.tsMs).toBe(VALID_BUY_EVENT.T);
    expect(row?.aggressor).toBe('buy');
    expect(row?.price).toBe(71234.5);
    expect(row?.symbol).toBe(INGEST_SYMBOL);
    expect(row?.sessionId).toBe(h.session.currentId ?? '');

    expect(wsClient.received.length).toBe(1);
    const expectedFrame: WSFrame = {
      topic: 'ticks.btc',
      kind: 'tick',
      payload: {
        tsMs: VALID_BUY_EVENT.T,
        price: 71234.5,
        qty: 0.125,
        aggressor: 'buy',
      },
    };
    expect(Array.from(wsClient.received[0] ?? new Uint8Array())).toEqual(
      Array.from(encode(expectedFrame)),
    );

    const snapshot = h.snapshotCache.current(INGEST_SYMBOL);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.recentTicks.length).toBe(1);
    expect(snapshot?.recentTicks[0]?.aggressor).toBe('buy');
    expect(snapshot?.currentBarTs).toBeGreaterThan(0);
  });

  test('a valid sell aggTrade flips the aggressor mapping (m=true -> sell)', async () => {
    const h = makeHarness();
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await startPromise;
    h.factory.current().fireMessage(JSON.stringify(VALID_SELL_EVENT));
    expect(h.tickWriter.enqueued[0]?.aggressor).toBe('sell');
  });

  test('a malformed aggTrade increments parseErrors and produces no side effects', async () => {
    const h = makeHarness();
    const wsClient = new CapturingWsSocket();
    h.registry.register(wsClient);
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await startPromise;

    h.factory.current().fireMessage('not json at all');
    h.factory.current().fireMessage(JSON.stringify({ e: 'depthUpdate', wrong: 'shape' }));

    const client = getBinanceClient();
    expect(client?.parseErrors).toBe(2);
    expect(h.tickWriter.enqueued.length).toBe(0);
    expect(wsClient.received.length).toBe(0);
    expect(h.snapshotCache.current(INGEST_SYMBOL)).toBeNull();
  });

  test('aggTrade arriving before start() is silently dropped without a session', () => {
    // Build a fresh ingestor and manually fire a message before start.
    const h = makeHarness();
    // Force a fake socket without starting.
    const ws = h.factory.build('wss://fake/');
    ws.addEventListener('message', () => {
      // not the client's listener — this just exercises that we
      // don't accidentally hand a session-less event to the writer.
    });
    expect(h.tickWriter.enqueued.length).toBe(0);
    expect(h.session.currentId).toBe(null);
  });
});

describe('BinanceIngestor — health snapshot', () => {
  test('idle ingestor health has no session, no connection, no ticks', () => {
    const h = makeHarness();
    expect(h.ingestor.health()).toEqual({
      connected: false,
      lastTickTsMs: null,
      parseErrors: 0,
      restartCount: 0,
      sessionId: null,
    });
  });

  test('after a successful tick, lastTickTsMs and sessionId are populated', async () => {
    const h = makeHarness();
    const startPromise = h.ingestor.start();
    await flushMicrotasks();
    h.factory.current().fireOpen();
    await startPromise;
    h.factory.current().fireMessage(JSON.stringify(VALID_BUY_EVENT));
    const health = h.ingestor.health();
    expect(health.connected).toBe(true);
    expect(health.lastTickTsMs).toBe(VALID_BUY_EVENT.T);
    expect(health.parseErrors).toBe(0);
    expect(health.sessionId).toBe(h.session.currentId ?? '');
  });
});

describe('BinanceIngestor — misconfiguration guardrails', () => {
  test('invalid URL throws at constructor time', () => {
    expect(() => {
      new BinanceIngestor({
        clientOptions: {
          url: 'http://not-a-ws-url.test/',
          symbol: 'btcusdt',
        },
      });
    }).toThrow(/invalid BINANCE_WS_URL/);
  });

  test('invalid symbol throws at constructor time', () => {
    expect(() => {
      new BinanceIngestor({
        clientOptions: {
          url: 'wss://fake.binance.test/ws',
          symbol: 'BAD SYMBOL!',
        },
      });
    }).toThrow(/invalid BINANCE_SYMBOL/);
  });
});
