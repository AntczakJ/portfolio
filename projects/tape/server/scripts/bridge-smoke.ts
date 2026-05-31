/**
 * Bridge smoke test — Task 1.4a.
 *
 * Sanity check that the TypeScript bridge transport (`BridgeClient`,
 * `FrameReader`, MessagePack codec) round-trips correctly against the
 * Rust placeholder echo binary at
 * `projects/tape/worker/target/<profile>/echo[.exe]`.
 *
 * Steps:
 *   1. Connect a `BridgeClient` to the bridge endpoint (defaults to
 *      `/tmp/tape-bridge.sock` on POSIX, `\\.\pipe\tape-bridge` on
 *      Windows, override via `BRIDGE_PATH`).
 *   2. Send three frames: a tick, a cell snapshot, a control command —
 *      using the msgpackr codec wrapper and the generated bridge types.
 *   3. Assert each echoed payload decodes to the value we sent.
 *   4. Close the client cleanly.
 *
 * This is NOT a CI test (that's Task 1.5b). It is the manual
 * end-to-end confirmation described in the per-project README under
 * "Bridge smoke test". Run sequence:
 *
 *   Terminal 1 (Rust echo worker):
 *     cd projects/tape/worker
 *     cargo build --bin echo
 *     ./target/debug/echo
 *
 *   Terminal 2 (this script):
 *     cd projects/tape/server
 *     bun run scripts/bridge-smoke.ts
 *
 * Exits 0 with `bridge smoke OK` on success; any other path is a hard
 * fail (assertion throws, connect error, decode mismatch).
 */

import { deepStrictEqual } from 'node:assert/strict';

import { BridgeClient, decode, defaultBridgePath, encode } from '../src/lib/bridge';
import type {
  CellSnapshot,
  ControlCommand,
  TickFrame,
} from '../src/lib/schemas/bridge';

const SMOKE_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  const path = defaultBridgePath();
  console.log(`bridge smoke: connecting to ${path}`);

  const inbox: Uint8Array[] = [];
  let resolveNextFrame: ((payload: Uint8Array) => void) | null = null;

  const client = new BridgeClient({
    path,
    autoReconnect: false,
    onStateChange: (state) => {
      console.log(`bridge smoke: state=${state}`);
    },
    onMessage: (payload) => {
      // The frame queue is drained in arrival order by awaitFrame() below;
      // arriving while no one is waiting parks the payload.
      if (resolveNextFrame !== null) {
        const resolve = resolveNextFrame;
        resolveNextFrame = null;
        resolve(payload);
        return;
      }
      inbox.push(payload);
    },
  });

  await client.connect();

  // Three representative frames covering the bridge schema vocabulary
  // — tick, cell snapshot, control command. ts-rs maps `i64` to
  // `bigint` on the TypeScript side, so timestamps and price buckets
  // are BigInt literals; the smoke uses safe-range values so the
  // round-trip comparison works under both `bigint` and `number`
  // decoders without coercion.
  const tick: TickFrame = {
    ts_ms: 1_717_000_000_000n,
    symbol: 'BTCUSDT',
    price: 71_234.5,
    qty: 0.125,
    aggressor: 'Buy',
  };
  const cell: CellSnapshot = {
    ts_ms: 1_717_000_060_000n,
    symbol: 'BTCUSDT',
    price_bucket: 71_235n,
    bid_volume: 12.5,
    ask_volume: 17.25,
    trades: 41,
  };
  const control: ControlCommand = { kind: 'Snapshot' };

  await sendAndAssert(client, encode(tick), tick, awaitFrame);
  await sendAndAssert(client, encode(cell), cell, awaitFrame);
  await sendAndAssert(client, encode(control), control, awaitFrame);

  await client.close('smoke complete');
  console.log('bridge smoke OK');

  /**
   * Either dequeue an already-arrived frame or park a resolver until
   * the next one lands. `SMOKE_TIMEOUT_MS` guards against the echo
   * binary going silent — we would rather see a clear timeout than a
   * hung script.
   */
  function awaitFrame(): Promise<Uint8Array> {
    const queued = inbox.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`bridge smoke: no frame within ${String(SMOKE_TIMEOUT_MS)}ms`));
      }, SMOKE_TIMEOUT_MS);
      resolveNextFrame = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };
    });
  }
}

async function sendAndAssert<T>(
  client: BridgeClient,
  payload: Uint8Array,
  expected: T,
  awaitFrame: () => Promise<Uint8Array>,
): Promise<void> {
  client.send(payload);
  const received = await awaitFrame();
  const decoded = decode<T>(received);
  // deepStrictEqual handles BigInt and nested objects out of the box.
  deepStrictEqual(decoded, expected);
}

main().catch((err: unknown) => {
  console.error('bridge smoke FAILED', err);
  process.exit(1);
});
