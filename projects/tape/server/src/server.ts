import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';

import { COMMIT_SHA } from './lib/commit';
import { pingDb } from './db';
import {
  WorkerPipeline,
  WorkerSupervisor,
  workerBinaryPath,
} from './lib/bridge';
import { encode } from './lib/bridge/codec';
import {
  buildOriginPredicate,
  resolveCORSAllowlist,
} from './lib/cors-allowlist';
import { getBinanceIngestor } from './lib/ingest/binance-ingestor';
import { getRetentionScheduler } from './lib/ingest/retention-scheduler';
import { getTickWriter } from './lib/ingest/tick-writer';
import {
  stripHopByHopRequestHeaders,
  stripTransportEncodingResponseHeaders,
} from './lib/proxy/transform';
import { replayRoutes } from './lib/replay/route';
import {
  HeartbeatLoop,
  WSSynthesizer,
  getRateLimit,
  getRegistry,
  getSnapshotCache,
} from './lib/ws';
import {
  healthResponseSchema,
  type BinanceHealth,
  type HealthResponse,
  type WorkerHealth,
  type WsHealth,
} from './lib/schemas/health';
import { type WSFrame } from './lib/schemas/ws';

/**
 * tape — Elysia control plane.
 *
 * Phase 1 scope landed so far:
 *   - Task 1.1: server skeleton + `/health` (status, commit, ts).
 *   - Task 1.2: Drizzle + Postgres scaffold + `/health.db` liveness probe.
 *   - Task 1.2a: ticks + footprint-cells schema + partitioning bootstrap.
 *   - Task 1.2b: tick ingest writer (`COPY ticks FROM STDIN` on a 50 ms
 *     coalescing window, 500-tick ring with drop-oldest overflow) +
 *     retention scheduler (daily 03:00 UTC sweep, `ensureRollingPartitions(2)`
 *     + `dropTickPartitionsOlderThan(30)`, bootstrap-once-on-start so a
 *     fresh container is partitioned before any tick is enqueued) +
 *     wiring of `partitionCreateLagDays` + `tickBatchFlushCount` on
 *     `/health.db`.
 *   - Task 1.4b: bridge serialization tooling + ts-rs codegen pipeline.
 *   - Task 1.4a: bridge transport scaffold + `/health.worker` observability.
 *   - Task 1.6b: WS fan-out endpoint + `/health.ws` observability.
 *   - Task 1.7: historic replay routes (`GET /api/replay/:symbol/:date`
 *     NDJSON cell stream + `GET /api/replay/:symbol/:date/ticks` bounded
 *     tick-tail window), Postgres-only read path per ADR-005.
 *
 * Auth (1.8) is a subsequent task — do not pre-implement.
 *
 * ADR-004 + Task 1.4a: the supervisor singleton below is constructed at
 * boot but is NOT started by `app.listen()`. Task 1.5 owns the spawn
 * wiring once the real worker binary exists; until then `/health.worker`
 * reports `state: 'idle'` and the smoke test / unit tests call `start()`
 * explicitly. See the per-project README "Local development" section.
 *
 * ADR-005 + Task 1.2b: the tick writer and retention scheduler are
 * constructed via their module-singleton accessors AND STARTED when
 * `import.meta.main` runs (see the bottom of this file). Both fail fast
 * on a missing `DATABASE_URL` — partition management must not silently
 * no-op (per the `src/db/partitions.ts` docblock), and the tick writer's
 * COPY path needs a live connection by definition. The `/health.db`
 * probe stays tolerant; this runtime path is not.
 *
 * ADR-006 + Task 1.6b: the WS endpoint at `/ws/stream` is always
 * mounted. The synthesizer that drives frames into the registry is
 * gated by `WS_SYNTHESIZE=1` — production deployments leave it OFF
 * because Task 1.3 / 1.5 replace the synthesizer with real ingest.
 */

const PORT = Number(process.env.PORT ?? 3001);

/**
 * **Worker pipeline mode (Task 1.5).** When set to `'1'`, the real
 * Rust `worker` binary is spawned at boot, the bridge client connects,
 * and the Binance ingest path pushes ticks INTO the worker (which
 * aggregates and emits `cell.delta` / `cell.close` back over the
 * bridge — those then propagate to WS clients).
 *
 * **Three-way mutex precedence (per Task 1.5 deliverable):**
 *
 *   1. `BINANCE_WS_ENABLED=1 && WORKER_PIPELINE_ENABLED=1` → full
 *      pipeline (Binance → tickWriter + bridge.send(tick) → worker →
 *      cell.delta / cell.close on the public WS).
 *   2. `BINANCE_WS_ENABLED=1 && WORKER_PIPELINE_ENABLED=0` → direct
 *      tick broadcast, NO cell aggregation (tape strip only — v1.0
 *      limitation per Task 1.3 AGENT_NOTES).
 *   3. `WS_SYNTHESIZE=1` (and BINANCE_WS_ENABLED=0) → deterministic
 *      dev synthesizer publishes both ticks and cells directly. The
 *      bridge is NOT in the loop.
 *
 * If both BINANCE_WS_ENABLED and WORKER_PIPELINE_ENABLED are on AND
 * WS_SYNTHESIZE is also on, BINANCE_WS_ENABLED wins (real feed beats
 * synth) and the worker pipeline still runs in front of it; the
 * synthesizer is silently disabled.
 */
const WORKER_PIPELINE_ENABLED = process.env.WORKER_PIPELINE_ENABLED === '1';

/**
 * Process-singleton supervisor. In Task 1.4a it was constructed-but-
 * not-started by design (no real worker binary existed). Task 1.5
 * replaces the placeholder with the real `worker` binary; when
 * `WORKER_PIPELINE_ENABLED=1`, the supervisor's binary path points at
 * `target/<profile>/worker[.exe]` and the pipeline calls `start()` at
 * boot. When disabled (the default at boot), the supervisor stays
 * idle and the binary path still resolves to `echo` so tests + 1.4a
 * smoke keep working unchanged.
 */
export const supervisor = new WorkerSupervisor(
  WORKER_PIPELINE_ENABLED
    ? { binaryPath: workerBinaryPath('worker') }
    : {},
);

/**
 * Tick ingest writer + retention scheduler singletons (ADR-005 / Task
 * 1.2b). Constructed lazily through `getTickWriter` / `getRetentionScheduler`
 * so a unit-test environment that imports this file but does not call
 * `app.listen()` does not start the timers. Exported for tests and for
 * the future Task 1.3 ingest path to reach `tickWriter.enqueue(...)`.
 */
export const tickWriter = getTickWriter();
export const retentionScheduler = getRetentionScheduler();

/**
 * WS process singletons. Exported so tests / future ingest paths can
 * reach into them without re-resolving through the getter. The
 * registry and snapshot cache are always live; the synthesizer is
 * conditionally constructed and the heartbeat loop is conditionally
 * started so a unit-test environment does not need to opt out.
 */
export const wsRegistry = getRegistry();
export const snapshotCache = getSnapshotCache();
export const heartbeatLoop = new HeartbeatLoop({ registry: wsRegistry });

/**
 * Per-IP WS connection-count cap (Phase 6 deploy hardening). Pre-accept
 * limiter that complements ADR-006's post-accept circuit breaker. Cap
 * default is 5 connections per source IP; override via
 * `WS_MAX_CONNECTIONS_PER_IP`. In-memory + per-process — see the module
 * docblock and AGENT_NOTES for the v2 horizontal-scale caveat.
 */
export const wsRateLimit = getRateLimit();

/**
 * CORS allowlist (Phase 6 deploy hardening). Resolved once at module
 * load: env-driven (`ALLOWED_ORIGINS` comma-separated) with sane
 * localhost defaults in development and a fail-closed empty list in
 * production-with-no-env. The `origin` predicate is consumed by
 * `@elysiajs/cors` for every cross-origin request; same-origin
 * navigations bypass it. See `src/lib/cors-allowlist.ts` for the
 * policy rationale.
 */
const corsAllowlist = resolveCORSAllowlist();
const originPredicate = buildOriginPredicate(corsAllowlist.origins);

/**
 * Binance ingest enabled flag (Task 1.3). Default is `'1'` — the
 * real ingest path is the v1 production source. Operators flip to
 * `'0'` when running the dev synthesizer alone (offline reproduction,
 * deterministic UI work, CI loops that should not depend on the
 * public Binance feed).
 */
const BINANCE_WS_ENABLED = (process.env.BINANCE_WS_ENABLED ?? '1') === '1';

/**
 * **Synthesizer ↔ real-ingest mutex (Task 1.3).**
 *
 * Both the dev synthesizer and the real Binance ingestor publish to
 * the SAME registry under the SAME topic (`ticks.btc`). Running both
 * would interleave a synthesised BTC random walk with the real
 * exchange feed and corrupt the snapshot cache (the recent-ticks ring
 * would mix real ticks and synth ticks). The two modes are mutually
 * exclusive by configuration.
 *
 * **Policy when both env vars are set to `'1'`:** BINANCE_WS_ENABLED
 * wins. The real feed is the v1 production source; the synthesizer is
 * a dev convenience. If an operator sets both, the most likely intent
 * is "I forgot to drop WS_SYNTHESIZE from the dev env" — silently
 * disabling the synthesizer in that case is the lower-surprise outcome
 * than disabling the real feed. The boot path logs a WARN so the
 * misconfiguration surfaces.
 */
const SYNTH_WANTED = process.env.WS_SYNTHESIZE === '1';
const SYNTH_ENABLED = SYNTH_WANTED && !BINANCE_WS_ENABLED;

/**
 * Worker pipeline singleton (Task 1.5). Constructed only when
 * `WORKER_PIPELINE_ENABLED=1`. Holds the BridgeClient connection to
 * the worker, dispatches inbound `cell.delta` / `cell.close` /
 * `snapshot` / `worker_ready` / `worker_unavailable` frames, and
 * surfaces the live `cellsOpen` + `ticksProcessed` counters on
 * `/health.worker`.
 */
export const workerPipeline = WORKER_PIPELINE_ENABLED
  ? new WorkerPipeline({
      supervisor,
      registry: wsRegistry,
      snapshotCache,
    })
  : null;

let synthesizer: WSSynthesizer | null = null;
if (SYNTH_ENABLED) {
  // Deterministic seed: env override → default 1. Documented in the
  // synthesizer module + the README so a reported demo session is
  // reproducible.
  const seedEnv = process.env.WS_SYNTHESIZE_SEED;
  const seed = seedEnv !== undefined ? Number(seedEnv) : undefined;
  synthesizer = new WSSynthesizer({
    registry: wsRegistry,
    snapshotCache,
    ...(seed !== undefined && !Number.isNaN(seed) ? { seed } : {}),
    // Offline cell-producing path: when the worker pipeline is also
    // enabled (WS_SYNTHESIZE=1 + WORKER_PIPELINE_ENABLED=1 +
    // BINANCE_WS_ENABLED=0), the synthesizer feeds its ticks INTO the
    // Rust worker so the full bridge loop produces cells without a live
    // Binance feed. The synthesizer suppresses its own cell emission in
    // this mode (the worker becomes the cell authority). When the
    // pipeline is null, the synthesizer keeps its self-contained
    // behaviour (emits ticks AND cells directly; bridge not in loop).
    ...(workerPipeline !== null ? { workerPipeline } : {}),
  });
}
export { synthesizer };

/**
 * Binance ingestor singleton (Task 1.3 + Task 1.5). Constructed only
 * when the env flag is on so a unit-test or synth-only environment
 * does not pay the constructor cost. When the worker pipeline is also
 * enabled, the ingestor pushes every aggTrade through it; otherwise
 * the legacy direct-broadcast path is unchanged.
 */
export const binanceIngestor = BINANCE_WS_ENABLED
  ? getBinanceIngestor(workerPipeline !== null ? { workerPipeline } : {})
  : null;

function readWorkerHealth(): WorkerHealth {
  // cellsOpen + ticksProcessed are owned by the worker pipeline (which
  // caches the latest SnapshotPayload from the worker). When the
  // pipeline is disabled, both surface as 0 — honest signal that no
  // worker is running, distinguishable from "worker running but quiet"
  // by the supervisor state + restartCount.
  const cellsOpen = workerPipeline?.metrics.cellsOpen ?? 0;
  const ticksProcessed = workerPipeline?.metrics.ticksProcessed ?? 0;
  return {
    state: supervisor.state,
    pid: supervisor.pid,
    restartCount: supervisor.restartCount,
    lastExitCode: supervisor.lastExitCode,
    cellsOpen,
    ticksProcessed,
  };
}

function readWsHealth(): WsHealth {
  return {
    connectedClients: wsRegistry.connectedClients,
    framesPerSecOut: wsRegistry.framesPerSecOut(),
    droppedFrameCount: wsRegistry.droppedFrameCount,
    overrunDisconnectCount: wsRegistry.overrunDisconnectCount,
    snapshotCacheHitRate: snapshotCache.cacheHitRate(),
    wsRateLimitedCount: wsRateLimit.rateLimitedCount,
  };
}

function readBinanceHealth(): BinanceHealth {
  // When BINANCE_WS_ENABLED=0, the ingestor is not constructed and
  // the sub-shape reads as the "absent producer" baseline. The schema
  // contract is honest in both cases — the field is always present so
  // Eden Treaty types stay stable.
  if (binanceIngestor === null) {
    return {
      connected: false,
      lastTickTsMs: null,
      parseErrors: 0,
      restartCount: 0,
      sessionId: null,
    };
  }
  return binanceIngestor.health();
}

/**
 * v1 hard-pinned single-symbol. The endpoint's snapshot lookup reads
 * this exact key; the synthesizer publishes under the same value.
 * v2 multi-symbol turns this into a per-connection query parameter
 * (`/ws/stream?symbol=ETHUSDT-PERP`) without changing the protocol —
 * the topic field on every frame already carries the routing info
 * per ADR-006.
 */
const V1_SYMBOL = 'BTCUSDT-PERP';

export const app = new Elysia()
  .use(
    cors({
      // ADR-style policy: env-driven allowlist with sane dev defaults
      // and a fail-closed empty list in production-with-no-env. Never
      // returns `Access-Control-Allow-Origin: *`. See
      // `src/lib/cors-allowlist.ts`.
      origin: originPredicate,
      // No auth in v1 → no credentials. Setting this to `false`
      // ensures the server never sends `Access-Control-Allow-Credentials`
      // even if a future allowlisted origin asks for it.
      credentials: false,
    }),
  )
  .use(
    swagger({
      documentation: {
        info: {
          title: 'tape API',
          version: '0.0.1',
          description:
            'Elysia control plane for the tape real-time orderflow visualizer.',
        },
      },
    }),
  )
  /**
   * Historic replay routes (Task 1.7, ADR-005). Mounted before `/health`
   * and the catch-all so `GET /api/replay/...` is served by the
   * NDJSON-streaming handler rather than proxied to Next.js. Replay reads
   * Postgres only (`footprint_cells` + `ticks`) — the offline-safe half
   * of ADR-005's live/replay read-split.
   */
  .use(replayRoutes)
  .get('/health', async (): Promise<HealthResponse> => {
    // `pingDb` tolerates a missing DATABASE_URL by design — `/health`
    // must answer on a fresh checkout. The rest of the app does not.
    const dbPing = await pingDb();
    // Task 1.2b wires `partitionCreateLagDays` from the retention
    // scheduler and `tickBatchFlushCount` from the tick writer. Both
    // counters read live values off the process singletons; both
    // singletons exist (constructed at module scope) but are only
    // started by the `import.meta.main` block below. In a unit-test
    // environment that imports this file without booting, both
    // counters legitimately read 0 — the schema contract is honest in
    // both cases.
    const db = {
      ...dbPing,
      partitionCreateLagDays: retentionScheduler.partitionCreateLagDays,
      tickBatchFlushCount: tickWriter.flushCount,
    };
    // Validate outbound payload at the boundary, never trust the literal
    // we constructed. If a future refactor breaks the contract, this
    // throws loudly rather than silently shipping a wrong shape.
    return healthResponseSchema.parse({
      status: 'ok',
      commit: COMMIT_SHA,
      ts: Date.now(),
      db,
      worker: readWorkerHealth(),
      ws: readWsHealth(),
      binance: readBinanceHealth(),
    });
  })
  /**
   * `/ws/stream` — ADR-006 single channel, topic-multiplexed
   * envelope (`{ topic, kind, payload }`), msgpackr binary frames
   * with `useRecords: false`.
   *
   * Frame mode: Elysia 1.4's `ws.send(Uint8Array)` ships a binary
   * frame natively via Bun's `ServerWebSocket` — no special body
   * config is required. The handler treats client → server messages
   * as advisory v1 (ignored), reserved for a future subscribe /
   * unsubscribe vocabulary in v2 multi-symbol.
   *
   * Lifecycle:
   *  - `open`:    register, ship snapshot, start the heartbeat loop
   *               if this is the first client.
   *  - `message`: v1 no-op. The browser does not yet have a
   *               protocol the server consumes. The `clientFrameSchema`
   *               reserved in ADR-006 is the v2 home for this.
   *  - `close`:   unregister, stop the heartbeat loop if the last
   *               client just left.
   */
  .ws('/ws/stream', {
    open(ws) {
      // Phase 6 hardening — pre-accept per-IP cap. Read the client IP
      // from `x-forwarded-for` (Fly.io's edge populates it; the first
      // hop in the comma-separated chain is the original client) and
      // fall back to the raw socket's remote address for direct
      // connections (local dev, tests). If neither is available,
      // treat the connection as 'unknown' and bucket all such
      // connections into a single counter — a misconfigured proxy
      // is worse than rate-limiting everyone behind it together,
      // because the alternative is uncapping the limiter.
      const xff = ws.data.headers['x-forwarded-for'];
      const xffFirst =
        typeof xff === 'string' && xff.length > 0
          ? (xff.split(',')[0] ?? '').trim()
          : null;
      const ip =
        (xffFirst !== null && xffFirst !== ''
          ? xffFirst
          : ws.remoteAddress) || 'unknown';

      if (!wsRateLimit.allow(ip)) {
        // 1008 "policy violation" is the canonical WS close code for
        // server-side limit enforcement. The browser sees the close
        // event and can decide whether to reconnect (typically with
        // a back-off — sustained 1008 means the client is the
        // problem). We never register the client, so the rest of
        // the WS path is a no-op.
        ws.close(1008, 'rate_limited');
        return;
      }

      const handle = wsRegistry.register({
        send: (bytes: Uint8Array) => {
          ws.send(bytes);
        },
        close: (code: number, reason: string) => {
          ws.close(code, reason);
        },
      });
      // Stash the registry id AND the resolved IP on the underlying
      // raw socket data so `close` can locate them without a
      // side-channel map. Elysia's ws.data is read-only on the
      // typed surface; we go through raw.data which Bun allows
      // mutation on.
      const rawData = ws.raw.data as Record<string, unknown>;
      rawData.clientId = handle.id;
      rawData.rateLimitIp = ip;

      snapshotCache.recordConnect();
      const cached = snapshotCache.current(V1_SYMBOL);
      // Even on cache miss we ship a well-formed snapshot frame so
      // the browser has a defined first-paint shape — empty arrays
      // / zero currentBarTs are valid per the schema, and the
      // browser's reducer treats them as "nothing to render yet".
      const payload =
        cached ?? {
          symbol: V1_SYMBOL,
          // Use 1 (positive int constraint) as a placeholder
          // baseline when no producer has ever populated the
          // cache — the next producer event overwrites this.
          // `Date.now()` would also satisfy the schema; either is
          // fine because the field is informational on a
          // cold-start snapshot.
          currentBarTs: Date.now(),
          cells: [],
          cellsOpen: [],
          recentTicks: [],
        };
      if (cached !== null) snapshotCache.recordHit();

      const frame: WSFrame = {
        topic: 'cells.btc',
        kind: 'snapshot',
        payload,
      };
      // Send the snapshot directly bypassing `broadcast` because
      // it targets exactly this client. Encode once at boundary.
      ws.send(encode(frame));

      // First client → start the heartbeat loop. Subsequent clients
      // are no-ops on the loop's idempotent `start`.
      if (wsRegistry.connectedClients === 1 && !heartbeatLoop.isRunning) {
        heartbeatLoop.start();
      }
    },
    message(_ws, _data) {
      // v1: ignore client → server messages. Reserved for a future
      // subscribe / unsubscribe vocabulary in v2 — the
      // `clientFrameSchema` envelope ADR-006 reserves is the home
      // for it.
    },
    close(ws, code, reason) {
      const data = ws.raw.data as Record<string, unknown>;
      const id = data.clientId;
      if (typeof id === 'number') {
        wsRegistry.unregister(id);
      }
      // Release the per-IP slot regardless of close path (clean 1000
      // / 1001, breaker-initiated 4290, abnormal 1006, our own
      // 1008). `release` is no-op for an unknown IP — covers the
      // case where the limiter rejected `open` and stashed nothing.
      const ip = data.rateLimitIp;
      if (typeof ip === 'string') {
        wsRateLimit.release(ip);
      }

      // Code 4290 is canonical (server-initiated overrun close per
      // ADR-006). 1000 / 1001 are clean client closes. Anything else
      // (incl. Bun's 1006 on abnormal disconnect) is logged at INFO
      // so a recurring code surfaces in ops without spamming WARN.
      if (code !== 1000 && code !== 1001 && code !== 4290) {
        console.info(
          `[ws/stream] client closed with code=${String(code)} reason=${reason}`,
        );
      }

      // Last client out → stop the heartbeat loop. Saves a 5 s
      // timer ticking against an empty registry forever in a
      // long-running idle process.
      if (wsRegistry.connectedClients === 0 && heartbeatLoop.isRunning) {
        heartbeatLoop.stop();
      }
    },
  })
  // Catch-all proxy: forward any HTTP request not handled above
  // (everything except /health, /swagger, /ws/stream, /api/replay/*) to
  // the co-located Next.js standalone server on localhost:3000.
  // Production deploy collapses both processes behind a single
  // external port — Fly only routes 443 to one internal port, so
  // the server takes the role of edge reverse proxy.
  .all('*', async ({ request }) => {
    const url = new URL(request.url);
    const target = `http://127.0.0.1:3000${url.pathname}${url.search}`;
    // Drop hop-by-hop REQUEST headers before forwarding so the upstream
    // sees a request addressed to 127.0.0.1:3000 (see proxy/transform.ts
    // for the full rationale on `host` / `connection`).
    const init: RequestInit = {
      method: request.method,
      headers: stripHopByHopRequestHeaders(request.headers),
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }
    const upstream = await fetch(target, init);
    // Bun's fetch transparently decompresses the upstream gzip/br body
    // but leaves the original `content-encoding` + `content-length`
    // headers attached. Forwarding those verbatim makes the browser try
    // to decompress an already-decompressed stream and fail with
    // `ERR_CONTENT_DECODING_FAILED`. Because this proxy serves the
    // ENTIRE Next frontend behind the single Fly port, that bug would
    // take the whole UI down on first deploy. Strip the transport /
    // encoding headers so the browser sees the post-decoded body for
    // what it is. Mirrors meld's catch-all proxy fix (commit 39f06d2).
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: stripTransportEncodingResponseHeaders(upstream.headers),
    });
  });

if (import.meta.main) {
  // ADR-005 / Task 1.2b: fail fast on missing DATABASE_URL for the
  // runtime ingest path. `/health.db` stays tolerant (`pingDb` returns
  // a structured "no probe" shape) but the writer + scheduler refuse to
  // start without a connection — partition management must not silently
  // no-op, and the COPY path needs a live socket.
  if (!process.env.DATABASE_URL) {
    console.error(
      '[tape-server] DATABASE_URL is required to boot the ingest writer + retention scheduler.\n' +
        '              Copy .env.example to .env (see ./README.md "Local development"),\n' +
        '              or export DATABASE_URL.',
    );
    process.exit(1);
  }
  // Bootstrap the retention scheduler BEFORE the tick writer so the
  // boot sweep guarantees partitions exist for "today" and the next
  // two months before any enqueue can race them. The boot sweep is
  // awaited; the daily 03:00 UTC re-arm is scheduled inside.
  await retentionScheduler.start();
  tickWriter.start();
  // Worker pipeline (Task 1.5): spawn the Rust binary BEFORE the
  // Binance ingestor starts, so the first aggTrade already has a
  // bridge connection to push through. The pipeline's `start()`
  // awaits the bridge handshake — a 5 s timeout fires if the worker
  // never sends `worker_ready`, after which the supervisor restarts
  // via its existing backoff curve.
  if (workerPipeline !== null) {
    try {
      await workerPipeline.start();
      console.log(
        '[worker-pipeline] WORKER_PIPELINE_ENABLED=1 — Rust worker spawned and bridge connected',
      );
    } catch (err) {
      console.error('[worker-pipeline] failed to start', err);
      // Don't abort — the rest of the boot path runs without
      // aggregation (the tape strip still works via direct WS tick
      // broadcasts; cells just won't be populated).
    }
  }
  // hostname 0.0.0.0 so Fly's edge proxy reaches the container's
  // private interface — Bun.serve sometimes binds to ::1 only.
  app.listen({ port: PORT, hostname: '0.0.0.0' });
  console.log(`tape-server listening on http://0.0.0.0:${String(PORT)}`);

  // Phase 6 hardening — log the resolved CORS policy at boot so the
  // source is visible without trial-and-error. The production-missing-
  // env case logs at WARN level: same-origin demo traffic still
  // works (CORS only gates cross-origin requests with an Origin
  // header), but every external embed / fetch is denied until
  // ALLOWED_ORIGINS is set on Fly.
  if (corsAllowlist.productionMissingEnv) {
    console.warn(
      '[tape-server] CORS allowlist is EMPTY in production — set ALLOWED_ORIGINS to a comma-separated list of origins (e.g. https://tape-demo.fly.dev). Cross-origin requests will be rejected until then.',
    );
  } else {
    console.log(
      `[tape-server] CORS allowlist (${corsAllowlist.source}): ${corsAllowlist.origins.join(', ')}`,
    );
  }
  console.log(
    `[tape-server] WS per-IP cap: ${String(wsRateLimit.cap)} concurrent connections`,
  );

  // Mutex log — surface a misconfiguration where both env vars were
  // set to '1'. The boot-time policy above already disabled the
  // synthesizer in that case; this log makes the choice visible.
  if (SYNTH_WANTED && BINANCE_WS_ENABLED) {
    console.warn(
      '[tape-server] WS_SYNTHESIZE=1 AND BINANCE_WS_ENABLED=1 — synthesizer disabled; real Binance ingest wins.',
    );
  }

  if (binanceIngestor !== null) {
    // Awaited so a boot-time misconfiguration (bad URL, network
    // partition) surfaces before app.listen() returns to the user.
    // After this resolves, the first aggTrade is ~milliseconds away.
    await binanceIngestor.start();
    console.log(
      `[binance-ingest] BINANCE_WS_ENABLED=1 — connected to Binance Futures aggTrade stream (sessionId=${
        binanceIngestor.health().sessionId ?? 'unknown'
      })`,
    );
  } else if (synthesizer !== null) {
    synthesizer.start();
    console.log(
      '[ws/synth] WS_SYNTHESIZE=1 — deterministic synthesizer started (5 ticks/s, cell.delta every 500ms, cell.close every 60s)',
    );
  } else {
    console.log(
      '[tape-server] no live tick producer started — set BINANCE_WS_ENABLED=1 (default) for the real feed or WS_SYNTHESIZE=1 for the deterministic dev stream.',
    );
  }

  // Graceful shutdown — stop the ingestor FIRST so pending Binance
  // frames have a chance to flush through the writer's pipeline,
  // then cancel the retention timer, then drain the tick writer.
  // Bun forwards SIGTERM / SIGINT to the foreground process; the
  // handlers below give the writer a chance to drain before exit.
  // Final flush is tolerant per the tick-writer docblock — a stuck
  // DB does not hang the shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[tape-server] received ${signal}, shutting down`);
    if (binanceIngestor !== null) {
      await binanceIngestor.stop();
    }
    if (synthesizer !== null) synthesizer.stop();
    if (workerPipeline !== null) {
      await workerPipeline.stop();
    }
    retentionScheduler.stop();
    await tickWriter.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

export type App = typeof app;
