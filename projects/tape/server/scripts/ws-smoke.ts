/**
 * WS smoke — Task 1.6b.
 *
 * Connects to a running `tape-server` at `ws://localhost:3001/ws/stream`,
 * decodes the initial snapshot, counts frames for 10 s grouped by
 * `kind`, then exits with code 0 if it received any frames and 1 if
 * the connection produced nothing at all.
 *
 * Intended manual workflow:
 *
 *   # Terminal 1
 *   WS_SYNTHESIZE=1 pnpm -F tape-server dev
 *
 *   # Terminal 2
 *   bun projects/tape/server/scripts/ws-smoke.ts
 *
 * Override target with `WS_URL=ws://...` or `--url=ws://...`.
 *
 * NOT a Bun test — this is a one-shot operator-facing script. The
 * CI-tracked behaviour lives in `src/lib/ws/__tests__/`.
 */

import { decode } from '../src/lib/bridge/codec';
import { type WSFrame, wsFrameSchema } from '../src/lib/schemas/ws';

const DEFAULT_URL = 'ws://localhost:3001/ws/stream';
const RUN_DURATION_MS = 10_000;

function resolveUrl(): string {
  const fromEnv = process.env.WS_URL;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--url=')) return arg.slice('--url='.length);
  }
  return DEFAULT_URL;
}

async function main(): Promise<number> {
  const url = resolveUrl();
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
      console.log('[ws-smoke] connected, listening for 10 s');
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

  await new Promise<void>((resolve) => setTimeout(resolve, RUN_DURATION_MS));

  console.log('[ws-smoke] done — frame counts by kind:');
  for (const [kind, count] of countsByKind) {
    console.log(`  ${kind}: ${String(count)}`);
  }
  console.log(`  total: ${String(totalFrames)}`);

  ws.close(1000, 'smoke complete');
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
