import type { WebSocket } from 'ws';

import type { VehicleTelemetry } from 'atlas-shared/schemas';

import { TokenBucket, type RateLimiterOptions } from './rate-limiter.js';
import { DEFAULT_SCOPE, type Scope } from './scope.js';

/**
 * One live WebSocket connection (ADR-003). Owns everything that is per-socket:
 *
 *   - the monotonic outbound `seq` (gap detection on the client);
 *   - the subscription `scope` (server-side narrowing, never client-trusted);
 *   - the COALESCE-TO-LATEST pending-tick buffer (the backpressure rule): when
 *     the socket's send buffer is backed up, a new tick does NOT queue behind the
 *     old one — it REPLACES the latest pending telemetry per vehicle, so a slow
 *     consumer gets the newest authoritative position, never a replayed backlog
 *     of stale motion. Memory is bounded by the fleet size, not the tick count;
 *   - the inbound-message token bucket (per-connection rate limit);
 *   - the heartbeat liveness flag (pong / app-level) used to reap dead sockets.
 *
 * The gateway holds a registry of these and fans engine ticks to them; this
 * class is the unit of backpressure and scoping.
 */

/** A socket is considered backed up past this many bytes buffered. */
const BACKPRESSURE_BYTES = 1 << 20; // 1 MiB

/** ws readyState OPEN constant (avoids importing the ws enum at runtime). */
const WS_OPEN = 1;

export interface ConnectionOptions {
  readonly rate: RateLimiterOptions;
}

export class Connection {
  readonly id: string;
  readonly socket: WebSocket;
  scope: Scope = DEFAULT_SCOPE;

  /** Liveness: set false before each heartbeat ping, true on pong. */
  isAlive = true;

  private seqCounter = 0;
  private readonly bucket: TokenBucket;

  /**
   * Latest pending telemetry per vehicle, awaiting a flush (the coalescing
   * buffer). Keyed by vehicleId so a newer tick overwrites an older pending one —
   * this IS the coalesce-to-latest rule. Carries the highest serverTick/ts seen.
   */
  private pendingTelemetry = new Map<string, VehicleTelemetry>();
  private pendingServerTick = 0;
  private pendingTs = 0;
  private hasPending = false;

  constructor(id: string, socket: WebSocket, options: ConnectionOptions) {
    this.id = id;
    this.socket = socket;
    this.bucket = new TokenBucket(options.rate);
  }

  /** Allocate the next monotonic sequence number for an outbound frame. */
  nextSeq(): number {
    const next = this.seqCounter;
    this.seqCounter += 1;
    return next;
  }

  /** Whether an inbound control frame is within this connection's rate budget. */
  allowInbound(): boolean {
    return this.bucket.tryConsume();
  }

  /** Whether the socket is open and writable. */
  get isOpen(): boolean {
    return this.socket.readyState === WS_OPEN;
  }

  /** Whether the socket's send buffer is backed up (apply backpressure). */
  get isBackedUp(): boolean {
    return this.socket.bufferedAmount > BACKPRESSURE_BYTES;
  }

  /**
   * Stage a tick's in-scope telemetry for this connection, coalescing to the
   * latest per vehicle. Returns the rows that should be sent IMMEDIATELY (when
   * the socket is NOT backed up) or, when backed up, returns null to signal the
   * caller to hold — the rows are merged into the pending buffer and flushed
   * later by {@link drainPending} once the buffer drains.
   *
   * Callers pass only the telemetry already filtered to this connection's scope.
   */
  stageTick(serverTick: number, ts: number, telemetry: readonly VehicleTelemetry[]): boolean {
    // Always coalesce into the pending buffer first (newest wins per vehicle).
    for (const t of telemetry) {
      this.pendingTelemetry.set(t.vehicleId, t);
    }
    if (serverTick >= this.pendingServerTick) {
      this.pendingServerTick = serverTick;
      this.pendingTs = ts;
    }
    this.hasPending = this.pendingTelemetry.size > 0;
    // If the socket is backed up, do NOT flush now — hold for drainPending.
    return !this.isBackedUp;
  }

  /**
   * Take the coalesced pending telemetry to send (and clear the buffer). Returns
   * null when there is nothing pending. The serverTick/ts are the NEWEST seen, so
   * a flushed frame after a stall reflects the latest world, not a replayed one.
   */
  takePending(): { serverTick: number; ts: number; telemetry: VehicleTelemetry[] } | null {
    if (!this.hasPending || this.pendingTelemetry.size === 0) return null;
    const telemetry = [...this.pendingTelemetry.values()];
    const serverTick = this.pendingServerTick;
    const ts = this.pendingTs;
    this.pendingTelemetry = new Map();
    this.hasPending = false;
    return { serverTick, ts, telemetry };
  }

  get hasPendingTelemetry(): boolean {
    return this.hasPending && this.pendingTelemetry.size > 0;
  }

  /** Reset the subscription to the whole-fleet default. */
  resetScope(): void {
    this.scope = DEFAULT_SCOPE;
  }
}

export { BACKPRESSURE_BYTES };
