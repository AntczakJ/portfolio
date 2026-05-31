/**
 * Worker smoke — Task 1.5.
 *
 * End-to-end check that the real `tape-worker` binary handshakes,
 * receives ticks, emits cell.delta back, responds to Snapshot, and
 * shuts down cleanly on Shutdown. Spawns the worker in-process via
 * `Bun.spawn` (no supervisor — we own the lifecycle for this smoke).
 *
 * Manual workflow:
 *   cd projects/tape/worker && cargo build --bin worker
 *   bun projects/tape/server/scripts/worker-smoke.ts
 *
 * Override the bridge endpoint via `BRIDGE_PATH=...` if a parallel
 * run already owns the default path.
 */

import {
  BridgeClient,
  workerBinaryPath,
  defaultBridgePath,
} from '../src/lib/bridge';
import { decode, encode } from '../src/lib/bridge/codec';
import { type BridgeFrame } from '../src/lib/schemas/bridge';

const BRIDGE_PATH = process.env.BRIDGE_PATH ?? defaultBridgePath();
const WORKER_BIN = workerBinaryPath('worker');

interface DecodedFrame {
  kind: BridgeFrame['kind'];
  payload: unknown;
}

const collected: DecodedFrame[] = [];
let resolveReady: (() => void) | null = null;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

async function main(): Promise<number> {
  console.log(`[worker-smoke] spawning ${WORKER_BIN}`);
  console.log(`[worker-smoke] bridge path: ${BRIDGE_PATH}`);

  const child = Bun.spawn({
    cmd: [WORKER_BIN],
    env: { ...process.env, BRIDGE_PATH },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Pipe child stderr to ours so worker logs are visible inline.
  void drainStream(child.stderr, '[worker]');

  // The worker binds the listener; give it a moment to come up before
  // the bridge client connects.
  await new Promise((r) => setTimeout(r, 300));

  const client = new BridgeClient({
    path: BRIDGE_PATH,
    onMessage: (bytes) => {
      try {
        const frame = decode<BridgeFrame>(bytes);
        collected.push({ kind: frame.kind, payload: frame.payload });
        console.log(`[worker-smoke] received: ${frame.kind}`);
        if (frame.kind === 'worker_ready' && resolveReady !== null) {
          resolveReady();
          resolveReady = null;
        }
      } catch (err) {
        console.error('[worker-smoke] decode failed', err);
      }
    },
    autoReconnect: false,
  });

  console.log('[worker-smoke] connecting');
  await client.connect();
  console.log('[worker-smoke] bridge connected, awaiting handshake');
  await readyPromise;
  console.log('[worker-smoke] handshake OK');

  // Send three ticks in the same minute bucket so they accumulate into
  // one cell, then a Snapshot command, then a Shutdown.
  const ts = Date.now();
  const bucketStart = ts - (ts % 60_000);
  for (let i = 0; i < 3; i++) {
    const tick: BridgeFrame = {
      kind: 'tick',
      payload: {
        ts_ms: BigInt(bucketStart + i * 100),
        symbol: 'BTCUSDT-PERP',
        price: 71_234.5,
        qty: 0.1 + i * 0.05,
        aggressor: i % 2 === 0 ? 'Buy' : 'Sell',
      },
    };
    client.send(encode(tick));
  }
  await new Promise((r) => setTimeout(r, 100));

  console.log('[worker-smoke] requesting snapshot');
  const snap: BridgeFrame = { kind: 'control', payload: { kind: 'Snapshot' } };
  client.send(encode(snap));
  await new Promise((r) => setTimeout(r, 200));

  console.log('[worker-smoke] requesting shutdown');
  const shutdown: BridgeFrame = {
    kind: 'control',
    payload: { kind: 'Shutdown' },
  };
  client.send(encode(shutdown));

  // Give the worker time to drain and ship cell.close + worker_unavailable.
  await new Promise((r) => setTimeout(r, 500));
  await client.close('smoke complete');

  // Best-effort: the worker exits on Shutdown.
  await child.exited;

  console.log('\n[worker-smoke] frame counts by kind:');
  const counts = new Map<string, number>();
  for (const f of collected) {
    counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  }
  for (const [kind, count] of counts) {
    console.log(`  ${kind}: ${count}`);
  }
  console.log(`  total: ${collected.length}`);

  const ok =
    counts.get('worker_ready') === 1 &&
    (counts.get('cell.delta') ?? 0) >= 3 &&
    counts.get('snapshot') === 1;
  console.log(ok ? '\n[worker-smoke] OK' : '\n[worker-smoke] FAILED');
  return ok ? 0 : 1;
}

async function drainStream(
  stream: ReadableStream<Uint8Array> | null,
  prefix: string,
): Promise<void> {
  if (stream === null) return;
  const dec = new TextDecoder();
  const reader = stream.getReader();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.length > 0) console.error(`${prefix} ${line}`);
        nl = buf.indexOf('\n');
      }
    }
  } catch {
    // stream closed
  } finally {
    reader.releaseLock();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[worker-smoke] fatal', err);
    process.exit(1);
  });
