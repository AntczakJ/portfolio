/**
 * WS smoke — Task 1.6b + Task 1.5c/1.5d end-to-end pipeline proof.
 *
 * Connects to a running `tape-server` at `ws://localhost:3001/ws/stream`,
 * decodes the initial snapshot, counts frames grouped by `kind`, then
 * exits 0 / 1 depending on the assertion mode (see below).
 *
 * Intended manual workflow:
 *
 *   # Terminal 1 — synth-only (ticks + synth cells, no worker)
 *   WS_SYNTHESIZE=1 BINANCE_WS_ENABLED=0 pnpm -F tape-server dev
 *
 *   # Terminal 1 — FULL offline pipeline (synth -> bridge -> Rust worker
 *   #              -> aggregated cell -> bridge -> WS):
 *   WORKER_PIPELINE_ENABLED=1 WS_SYNTHESIZE=1 BINANCE_WS_ENABLED=0 \
 *     DATABASE_URL=postgres://tape:tape@localhost:5435/tape \
 *     bun src/server.ts
 *
 *   # Terminal 2
 *   bun projects/tape/server/scripts/ws-smoke.ts
 *
 * Overrides:
 *   - `WS_URL=ws://...` or `--url=ws://...`  — target endpoint.
 *   - `WS_SMOKE_DURATION_MS=70000`           — capture window. Use ≥ 61 s
 *     to cross a 1-minute bar boundary and observe a `cell.close`.
 *   - `WS_SMOKE_REQUIRE_CELLS=1`             — fail (exit 1) unless BOTH a
 *     `cell.delta` AND a `cell.close` arrive (the full-pipeline proof).
 *     Default mode only requires "any frame at all".
 *
 * NOT a Bun test — this is a one-shot operator-facing script. The
 * CI-tracked behaviour lives in `src/lib/ws/__tests__/`.
 */

import { decode } from '../src/lib/bridge/codec';
import { type WSFrame, wsFrameSchema } from '../src/lib/schemas/ws';

const DEFAULT_URL = 'ws://localhost:3001/ws/stream';
const DEFAULT_DURATION_MS = 10_000;

function resolveUrl(): string {
  const fromEnv = process.env.WS_URL;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--url=')) return arg.slice('--url='.length);
  }
  return DEFAULT_URL;
}

function resolveDurationMs(): number {
  const fromEnv = process.env.WS_SMOKE_DURATION_MS;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    const n = Number(fromEnv);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return DEFAULT_DURATION_MS;
}

const REQUIRE_CELLS = process.env.WS_SMOKE_REQUIRE_CELLS === '1';

async function main(): Promise<number> {
  const url = resolveUrl();
  const durationMs = resolveDurationMs();
  console.log(`[ws-smoke] connecting to ${url}`);

  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  const countsByKind = new Map<string, number>();
  let totalFrames = 0;
  let snapshotSummary: string | null = null;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('connect timeout (5 s)'));
    }, 5_000);

    ws.addEventListener('open', () => {
      clearTimeout(timeoutId);
      console.log(
        `[ws-smoke] connected, listening for ${String(Math.round(durationMs / 1000))} s${
          REQUIRE_CELLS ? ' (require cell.delta + cell.close)' : ''
        }`,
      );
      resolve();
    });

    ws.addEventListener('error', (ev) => {
      clearTimeout(timeoutId);
      reject(new Error(`socket error: ${String(ev)}`));
    });
  });

  ws.addEventListener('message', (event) => {
    const data = event.data;
    if (!(data instanceof ArrayBuffer)) {
      console.warn(`[ws-smoke] non-binary frame: ${typeof data}`);
      return;
    }
    const frame = decode<WSFrame>(new Uint8Array(data));
    const parsed = wsFrameSchema.safeParse(frame);
    if (!parsed.success) {
      console.error(
        `[ws-smoke] schema parse failed for kind=${String(frame.kind ?? '?')}`,
      );
      return;
    }
    totalFrames++;
    countsByKind.set(parsed.data.kind, (countsByKind.get(parsed.data.kind) ?? 0) + 1);
    if (parsed.data.kind === 'snapshot' && snapshotSummary === null) {
      const p = parsed.data.payload;
      snapshotSummary = `symbol=${p.symbol} currentBarTs=${String(p.currentBarTs)} cells=${String(p.cells.length)} cellsOpen=${String(p.cellsOpen.length)} recentTicks=${String(p.recentTicks.length)}`;
      console.log(`[ws-smoke] snapshot received: ${snapshotSummary}`);
    }
  });

  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

  console.log('[ws-smoke] done — frame counts by kind:');
  for (const [kind, count] of countsByKind) {
    console.log(`  ${kind}: ${String(count)}`);
  }
  console.log(`  total: ${String(totalFrames)}`);

  ws.close(1000, 'smoke complete');

  if (REQUIRE_CELLS) {
    const snapshots = countsByKind.get('snapshot') ?? 0;
    const ticks = countsByKind.get('tick') ?? 0;
    const deltas = countsByKind.get('cell.delta') ?? 0;
    const closes = countsByKind.get('cell.close') ?? 0;
    const ok = snapshots >= 1 && ticks >= 1 && deltas >= 1 && closes >= 1;
    console.log(
      ok
        ? '[ws-smoke] PASS — snapshot + tick + cell.delta + cell.close all observed (full pipeline live)'
        : `[ws-smoke] FAIL — require snapshot>=1 tick>=1 cell.delta>=1 cell.close>=1, got snapshot=${String(
            snapshots,
          )} tick=${String(ticks)} cell.delta=${String(deltas)} cell.close=${String(closes)}`,
    );
    return ok ? 0 : 1;
  }

  return totalFrames > 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error('[ws-smoke] fatal:', err);
    process.exit(1);
  });
