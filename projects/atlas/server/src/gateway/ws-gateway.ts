import websocket from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';

import {
  clientFrameSchema,
  HEARTBEAT_INTERVAL_MS,
  serverFrameSchema,
} from 'atlas-shared/schemas/ws';
import type { ClientFrame } from 'atlas-shared/schemas/ws';

import type { EngineService } from '../engine/engine-service.js';
import type { EngineTickOutput } from '../engine/shell/engine.js';
import { Connection } from './connection.js';
import {
  buildEventFrame,
  buildHeartbeatFrame,
  buildSnapshotFrame,
  buildTickFrame,
  type ServerFrame,
} from './frames.js';
import { filterTelemetry } from './scope.js';

/**
 * The `@fastify/websocket` telemetry gateway (Task 4.1, ADR-003 / ADR-007).
 *
 * THE proof viewer 1 looks for in DevTools: exactly ONE WebSocket connection
 * carrying telemetry frames, genuinely pushed — never a polling loop. The
 * gateway:
 *
 *   - registers `@fastify/websocket` and the `/ws` upgrade route;
 *   - on connect, sends a `snapshot` frame (definitions + current telemetry) so a
 *     cold client renders the map immediately, then streams `tick` deltas;
 *   - subscribes once to `engineService.onTick` and FANS each tick to every
 *     connection, server-side-scoped + coalesced-to-latest under backpressure;
 *   - forwards the tick's `events[]` as `event` frames;
 *   - sends a 20 s `heartbeat` (under the Fly ~60 s edge idle timeout) and uses
 *     ws ping/pong to reap dead sockets;
 *   - routes inbound control frames (subscribe / unsubscribe / snapshot.request /
 *     sim.control), Zod-validated at the boundary (jitless) and per-connection
 *     rate-limited; malformed frames are dropped, never trusted.
 *
 * It is a single in-process fan-out (no broker, ADR-007): one engine, one
 * source of truth, every client connects to it.
 */

export interface WsGatewayOptions {
  readonly engineService: EngineService;
  /** WS upgrade path. Defaults to `/ws`. */
  readonly path?: string;
  /** Per-connection inbound steady message rate (frames/sec). Default 10. */
  readonly inboundRatePerSec?: number;
  /** Per-connection inbound burst allowance. Default 20. */
  readonly inboundBurst?: number;
  /** Heartbeat cadence in ms. Defaults to the contract's 20 s (ADR-003); only
   * overridden in smoke/tests to keep them quick. */
  readonly heartbeatIntervalMs?: number;
  /** Validate every OUTBOUND frame against the Zod contract. Default: off in
   * production, on otherwise (a contract self-check the builders cannot drift
   * past). */
  readonly validateOutbound?: boolean;
}

/** Debounce `snapshot.request` so a flapping connection cannot snapshot-storm. */
const SNAPSHOT_REQUEST_MIN_INTERVAL_MS = 1000;
/** Cap demo speed (mirrors the schema bound; defence in depth). */
const MAX_SPEED_MULTIPLIER = 16;

interface ConnectionExtras {
  lastSnapshotRequestAt: number;
}

export async function registerWsGateway(
  app: FastifyInstance,
  options: WsGatewayOptions,
): Promise<void> {
  const { engineService } = options;
  const path = options.path ?? '/ws';
  const validateOutbound = options.validateOutbound ?? process.env.NODE_ENV !== 'production';
  const inboundRate = {
    ratePerSec: options.inboundRatePerSec ?? 10,
    burst: options.inboundBurst ?? 20,
  };
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  await app.register(websocket);

  /** Live connections + their per-connection extras (snapshot debounce clock). */
  const connections = new Map<Connection, ConnectionExtras>();
  let connectionSeq = 0;

  // --- outbound send helpers ------------------------------------------------

  function send(conn: Connection, frame: ServerFrame): void {
    if (!conn.isOpen) return;
    if (validateOutbound) {
      // Contract self-check: fail loudly in dev/test if a builder drifts from
      // the shared schema. Off in production (cost); never crashes the fan-out —
      // a bad frame is logged and skipped. The shared union is the single source
      // of truth for the wire shape.
      const check = serverFrameSchema.safeParse(frame);
      if (!check.success) {
        app.log.error(
          { issues: check.error.issues, frameType: frame.t },
          'outbound frame failed contract validation',
        );
        return;
      }
    }
    try {
      conn.socket.send(JSON.stringify(frame));
    } catch (err) {
      app.log.warn({ err, conn: conn.id }, 'ws send failed; closing connection');
      closeConnection(conn);
    }
  }

  function sendSnapshot(conn: Connection): void {
    const snap = engineService.snapshot();
    const telemetry = filterTelemetry(conn.scope, snap.telemetry);
    send(
      conn,
      buildSnapshotFrame({
        seq: conn.nextSeq(),
        serverTick: snap.serverTick,
        ts: snap.ts,
        definitions: engineService.definitions,
        telemetry,
      }),
    );
  }

  // --- per-tick fan-out (the hot path) --------------------------------------

  function fanOutTick(output: EngineTickOutput): void {
    for (const conn of connections.keys()) {
      if (!conn.isOpen) continue;
      const scoped = filterTelemetry(conn.scope, output.telemetry);

      // Coalesce-to-latest under backpressure: stageTick merges the rows into the
      // connection's pending buffer (newest-per-vehicle wins) and tells us whether
      // we may flush now (socket not backed up).
      const canFlushNow = conn.stageTick(output.serverTick, output.ts, scoped);
      if (canFlushNow) {
        const pending = conn.takePending();
        if (pending !== null) {
          send(conn, buildTickFrame(conn.nextSeq(), pending.serverTick, pending.ts, pending.telemetry));
        }
      }

      // Events are low-volume and feed-critical; forward each in scope. (A scoped
      // connection still hears events for vehicles it can see.)
      for (const event of output.events) {
        if (conn.scope.vehicleIds !== null && !conn.scope.vehicleIds.has(event.vehicleId)) continue;
        send(conn, buildEventFrame(conn.nextSeq(), output.serverTick, event));
      }
    }
  }

  /**
   * A drain pass: any connection whose send buffer has recovered flushes its
   * coalesced pending telemetry. Runs alongside the heartbeat tick so a recovered
   * slow consumer gets the LATEST world, not a replayed backlog.
   */
  function drainBackpressure(): void {
    for (const conn of connections.keys()) {
      if (!conn.isOpen || conn.isBackedUp) continue;
      const pending = conn.takePending();
      if (pending !== null) {
        send(conn, buildTickFrame(conn.nextSeq(), pending.serverTick, pending.ts, pending.telemetry));
      }
    }
  }

  const offTick = engineService.onTick(fanOutTick);

  // --- heartbeat + dead-socket reaping --------------------------------------

  const heartbeat = setInterval(() => {
    const serverTick = engineService.currentTick;
    const ts = Date.now();
    for (const conn of [...connections.keys()]) {
      if (!conn.isOpen) {
        closeConnection(conn);
        continue;
      }
      // Reap a socket that did not pong since the last beat.
      if (!conn.isAlive) {
        app.log.info({ conn: conn.id }, 'ws heartbeat timeout; terminating');
        terminate(conn);
        continue;
      }
      conn.isAlive = false;
      try {
        conn.socket.ping();
      } catch {
        terminate(conn);
        continue;
      }
      send(conn, buildHeartbeatFrame(conn.nextSeq(), serverTick, ts));
    }
    // Flush any backpressure-held telemetry to recovered consumers.
    drainBackpressure();
  }, heartbeatIntervalMs);
  heartbeat.unref();

  // --- inbound control-frame routing ----------------------------------------

  function handleClientFrame(conn: Connection, frame: ClientFrame, extras: ConnectionExtras): void {
    switch (frame.t) {
      case 'subscribe': {
        conn.scope = {
          vehicleIds: frame.vehicleIds !== undefined ? new Set(frame.vehicleIds) : null,
          bbox: frame.bbox ?? null,
        };
        // A scope change re-bases what the client sees — send a fresh snapshot so
        // it reconciles immediately rather than waiting for the next tick.
        sendSnapshot(conn);
        break;
      }
      case 'unsubscribe': {
        conn.resetScope();
        sendSnapshot(conn);
        break;
      }
      case 'snapshot.request': {
        const now = Date.now();
        if (now - extras.lastSnapshotRequestAt < SNAPSHOT_REQUEST_MIN_INTERVAL_MS) break;
        extras.lastSnapshotRequestAt = now;
        sendSnapshot(conn);
        break;
      }
      case 'sim.control': {
        handleSimControl(conn, frame);
        break;
      }
    }
  }

  function handleSimControl(conn: Connection, frame: Extract<ClientFrame, { t: 'sim.control' }>): void {
    switch (frame.action) {
      case 'pause':
        engineService.pause();
        break;
      case 'resume':
        engineService.resume();
        break;
      case 'setSpeed':
        engineService.setSpeed(Math.min(MAX_SPEED_MULTIPLIER, frame.multiplier));
        break;
      case 'seek': {
        // A deterministic re-fold; the result is the authoritative state at the
        // target tick, returned as a fresh snapshot so the client reconciles.
        const snap = engineService.seek(frame.tick);
        const telemetry = filterTelemetry(conn.scope, snap.telemetry);
        send(
          conn,
          buildSnapshotFrame({
            seq: conn.nextSeq(),
            serverTick: snap.serverTick,
            ts: snap.ts,
            definitions: engineService.definitions,
            telemetry,
          }),
        );
        break;
      }
    }
  }

  // --- connection lifecycle -------------------------------------------------

  function closeConnection(conn: Connection): void {
    connections.delete(conn);
    try {
      if (conn.isOpen) conn.socket.close();
    } catch {
      /* already closing */
    }
  }

  function terminate(conn: Connection): void {
    connections.delete(conn);
    try {
      conn.socket.terminate();
    } catch {
      /* already gone */
    }
  }

  app.get(path, { websocket: true }, (socket: WebSocket, _request: FastifyRequest) => {
    connectionSeq += 1;
    const conn = new Connection(`ws-${String(connectionSeq)}`, socket, { rate: inboundRate });
    const extras: ConnectionExtras = { lastSnapshotRequestAt: 0 };
    connections.set(conn, extras);
    app.log.info({ conn: conn.id, connections: connections.size }, 'ws connected');

    // Snapshot-on-connect: a cold client renders the map immediately.
    sendSnapshot(conn);

    socket.on('pong', () => {
      conn.isAlive = true;
    });

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      // Per-connection inbound rate limit (the WS control channel is public).
      if (!conn.allowInbound()) {
        app.log.warn({ conn: conn.id }, 'ws inbound rate exceeded; frame dropped');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(normalizeRaw(raw)) as unknown;
      } catch {
        // Not JSON — drop silently (never crash on client input).
        return;
      }
      const result = clientFrameSchema.safeParse(parsed);
      if (!result.success) {
        // Malformed control frame — drop it (never trust client input, ADR-003).
        app.log.debug({ conn: conn.id }, 'ws inbound frame failed validation; dropped');
        return;
      }
      try {
        handleClientFrame(conn, result.data, extras);
      } catch (err) {
        // A handler failure must not take down the socket or the fan-out.
        app.log.error({ err, conn: conn.id }, 'ws frame handler error');
      }
    });

    socket.on('close', () => {
      connections.delete(conn);
      app.log.info({ conn: conn.id, connections: connections.size }, 'ws disconnected');
    });

    socket.on('error', (err: Error) => {
      app.log.warn({ err, conn: conn.id }, 'ws socket error');
      terminate(conn);
    });
  });

  // Tear down the engine subscription, the heartbeat, and live sockets when the
  // app closes (graceful shutdown drain).
  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    offTick();
    for (const conn of [...connections.keys()]) {
      closeConnection(conn);
    }
    await Promise.resolve();
  });
}

/** Normalize the ws `message` payload (Buffer | ArrayBuffer | Buffer[]) to text. */
function normalizeRaw(raw: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  return raw.toString('utf8');
}
