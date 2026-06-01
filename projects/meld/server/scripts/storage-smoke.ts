/**
 * storage-smoke — end-to-end persistence check for Task 1.3.
 *
 * Drives the Storage adapter through a complete write / disconnect /
 * reconnect / read cycle, using the canonical `@hocuspocus/provider`
 * client so the wire format matches the Hocuspocus framework's own
 * message envelope (varString documentName/sessionId prefix + Auth
 * handshake + sync). The canonical y-websocket binary protocol is
 * NOT what Hocuspocus 4 speaks on the wire — it speaks a superset
 * with its own multiplexing prefix, so a hand-rolled client must
 * mirror the framework's `OutgoingMessage` shape. The provider does
 * that for free.
 *
 * Flow:
 *
 *   1. POST /api/boards → mint a fresh board with a real uuid.
 *   2. Connect a HocuspocusProvider against /ws/board/${boardId}
 *      with a fresh Y.Doc. Wait for `onSynced` so the inbound state
 *      (empty) lands and the framework is ready to apply our update.
 *   3. Mutate the Y.Doc via `Y.Map.set('shape1', ...)` inside a
 *      transact() — the provider forwards the produced update on the
 *      WS at sub-frame latency.
 *   4. Wait through the debounce window so `onStoreDocument` fires
 *      and the snapshot lands in `boards.state`.
 *   5. Destroy the provider (closes the WS).
 *   6. Connect a fresh provider against the same board URL with a
 *      fresh empty Y.Doc. Wait for `onSynced` — the server's load
 *      path replays snapshot + ops into the doc.
 *   7. Assert the `Y.Map.get('shape1')` shape survives the round trip.
 *
 * Usage (Postgres must be up; meld-server must be running in another
 * terminal):
 *
 *   pnpm -F meld-server dev   # terminal 1
 *   pnpm -F meld-server storage:smoke   # terminal 2
 *
 * Exit code 0 on success, 1 on failure.
 */
import { HocuspocusProvider } from '@hocuspocus/provider';
import { WebSocket as WsWebSocket } from 'ws';
import * as Y from 'yjs';

const PORT = process.env.PORT ?? '3002';
const API_BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}/ws/board`;
/** Per-board WS URL — the path filter regex on the server requires
 * `/ws/board/:boardId`. The HocuspocusProvider's `name` config is the
 * documentName carried in the message envelope (varString prefix), NOT
 * appended to the URL — so we form the URL explicitly. */
function wsUrlFor(boardId: string): string {
  return `${WS_BASE}/${boardId}`;
}

/**
 * Wait window between sending an op and asserting it has been
 * persisted. Server-side debounce is 5_000 ms idle; we wait 6_500 ms
 * to give the framework a clear flush window.
 */
const DEBOUNCE_WAIT_MS = 6_500;

interface CreateBoardResponse {
  boardId: string;
  name: string;
  createdAt: number;
}

interface StorageHealthSlice {
  snapshotCount: number;
  snapshotBytes: number;
  opsAppended: number;
  compactionRuns: number;
  replayFromOpsCount: number;
}

interface HealthResponse {
  db: { storage: StorageHealthSlice };
}

async function createBoard(): Promise<CreateBoardResponse> {
  const res = await fetch(`${API_BASE}/api/boards`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'storage-smoke' }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/boards failed: ${res.status.toString()}`);
  }
  return res.json() as Promise<CreateBoardResponse>;
}

async function fetchHealth(): Promise<HealthResponse | null> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) return null;
  return res.json() as Promise<HealthResponse>;
}

/**
 * Build a HocuspocusProvider session bound to a fresh Y.Doc. Resolves
 * when the provider has completed its initial sync round-trip with the
 * server.
 */
async function openSession(boardId: string): Promise<{
  provider: HocuspocusProvider;
  doc: Y.Doc;
}> {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: wsUrlFor(boardId),
    name: boardId,
    document: doc,
    // Provider attaches its own awareness instance by default. We do
    // not exercise the awareness path in this smoke (Task 1.X-control
    // owns the welcome-frame test), so passing null keeps the
    // observed log surface tight. The framework's ping mechanism
    // still works because the WS layer has its own timeout.
    awareness: null,
    // Provide a v1 server-side token. v1 has no token verification
    // wired (Phase 1.7 better-auth scaffold-only); the provider
    // ALWAYS sends an Auth message and the server's `onConnect` does
    // not check tokens, so any non-null string works.
    token: 'storage-smoke',
    // Use `ws`'s Node WebSocket as the WebSocket constructor.
    WebSocketPolyfill: WsWebSocket as unknown as typeof WebSocket,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('provider did not sync within 10 s'));
    }, 10_000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return { provider, doc };
}

async function main(): Promise<void> {
  console.log('[storage-smoke] creating board via POST /api/boards…');
  const board = await createBoard();
  console.log(`[storage-smoke] board id: ${board.boardId}`);

  // --- Session 1: write a shape -----------------------------------
  console.log('[storage-smoke] session 1: connect + writeMap.set("shape1", ...)');
  const session1 = await openSession(board.boardId);
  const writeMap = session1.doc.getMap<{ type: string; x: number; y: number }>(
    'shapes',
  );
  session1.doc.transact(() => {
    writeMap.set('shape1', { type: 'rect', x: 10, y: 20 });
  });

  console.log(
    `[storage-smoke] holding connection open for ${DEBOUNCE_WAIT_MS.toString()} ms to let debounce flush…`,
  );
  await new Promise<void>((r) => setTimeout(r, DEBOUNCE_WAIT_MS));

  // Pull a metrics snapshot WHILE the connection is open so we observe
  // post-flush counters reflecting session 1's writes.
  const midHealth = await fetchHealth();
  if (midHealth) {
    console.log(
      `[storage-smoke] /health.db.storage (after session 1 debounce): ${JSON.stringify(midHealth.db.storage)}`,
    );
  }

  session1.provider.destroy();
  await new Promise<void>((r) => setTimeout(r, 300));
  console.log('[storage-smoke] session 1 destroyed');

  // --- Session 2: read the shape back -----------------------------
  console.log('[storage-smoke] session 2: open fresh provider + assert shape1 survives');
  const session2 = await openSession(board.boardId);
  const readMap = session2.doc.getMap<{ type: string; x: number; y: number }>(
    'shapes',
  );
  const shape = readMap.get('shape1');

  let ok = true;
  if (!shape) {
    console.error(
      '[storage-smoke] FAIL: shape1 not present on reconnected doc — persistence path is broken',
    );
    ok = false;
  } else if (shape.type !== 'rect' || shape.x !== 10 || shape.y !== 20) {
    console.error(
      `[storage-smoke] FAIL: shape1 round-trip mismatch — got ${JSON.stringify(shape)}`,
    );
    ok = false;
  } else {
    console.log(
      `[storage-smoke] PASS: shape1 round-tripped through Postgres — ${JSON.stringify(shape)}`,
    );
  }

  session2.provider.destroy();
  await new Promise<void>((r) => setTimeout(r, 300));

  // Final metrics snapshot — surfaces the smoke's observable footprint
  // on the storage counters so the report-back has real numbers.
  const finalHealth = await fetchHealth();
  if (finalHealth) {
    console.log(
      `[storage-smoke] /health.db.storage (final): ${JSON.stringify(finalHealth.db.storage)}`,
    );
  }

  process.exit(ok ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error('[storage-smoke] uncaught error:', err);
  process.exit(1);
});
