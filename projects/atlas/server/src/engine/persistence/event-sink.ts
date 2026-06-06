import { desc, lt, sql } from 'drizzle-orm';

import type { SimEvent, VehicleTelemetry } from 'atlas-shared/schemas';

import type { AtlasDb } from '../../db/drizzle.js';
import { events, telemetrySnapshots } from '../../db/schema/index.js';
import type { EngineTickOutput } from '../shell/engine.js';

/**
 * Persistence + event sink (ADR-005 C1 / D1) — the QUEUED ASYNC write sink the
 * tick loop hands output to WITHOUT blocking on a DB write.
 *
 * The engine is the source of truth for live geo; persistence serves the events
 * feed, the snapshot frame on a cold connect, the SSR floor, and reconnect
 * reconcile. So this sink does the MINIMUM the reads need, off the hot path:
 *
 *   - EVENTS: append every event (the feed is a bounded rolling window, ADR-005
 *     C1 — a retention sweep caps it; this is NOT a long-horizon log). Inserts
 *     are batched per drain and de-duplicated on the unique `id` (so a seek
 *     replaying the same tick does not double-insert).
 *   - TELEMETRY SNAPSHOT: upsert the latest per-vehicle telemetry PERIODICALLY
 *     (every `snapshotEveryTicks`), NOT the per-tick firehose — one row per
 *     vehicle, upserted, so the cold-connect snapshot read is a single scan.
 *
 * Backpressure / non-blocking: `ingest` is synchronous and only enqueues; a
 * single in-flight `drain` does the IO. If a drain is slow, ticks keep enqueuing
 * (the queue coalesces the latest telemetry per vehicle, so it cannot grow
 * unbounded with stale snapshots). Errors are logged via the injected logger and
 * never propagate into the tick loop (we do not crash the sim on a transient DB
 * hiccup).
 */

export interface EventSinkLogger {
  error: (obj: unknown, msg?: string) => void;
}

export interface EventSinkOptions {
  /** Upsert the telemetry snapshot every N ticks (default 5 -> every ~5 s). */
  readonly snapshotEveryTicks?: number;
  /** Cap the events window to the most recent N rows (default 500). */
  readonly maxEvents?: number;
  /** Run the retention sweep every N drains (default 20). */
  readonly sweepEveryDrains?: number;
}

interface PendingTelemetry {
  readonly telemetry: VehicleTelemetry;
  readonly serverTick: number;
}

export class EventSink {
  private readonly db: AtlasDb;
  private readonly log: EventSinkLogger;
  private readonly snapshotEveryTicks: number;
  private readonly maxEvents: number;
  private readonly sweepEveryDrains: number;

  /** Pending events to insert, keyed by id (dedupe on replay). */
  private pendingEvents = new Map<string, SimEvent>();
  /** Latest pending telemetry per vehicle (coalesced — newest wins). */
  private pendingTelemetry = new Map<string, PendingTelemetry>();
  private draining = false;
  private drainCount = 0;
  private lastSnapshotTick = -Infinity;

  constructor(db: AtlasDb, log: EventSinkLogger, options: EventSinkOptions = {}) {
    this.db = db;
    this.log = log;
    this.snapshotEveryTicks = options.snapshotEveryTicks ?? 5;
    this.maxEvents = options.maxEvents ?? 500;
    this.sweepEveryDrains = options.sweepEveryDrains ?? 20;
  }

  /**
   * Enqueue a tick's output. SYNCHRONOUS and cheap — never awaits a write. The
   * actual IO happens in `drain`, which the caller kicks (fire-and-forget) after
   * ingest. Telemetry snapshots are throttled to `snapshotEveryTicks`.
   */
  ingest(output: EngineTickOutput): void {
    for (const event of output.events) {
      this.pendingEvents.set(event.id, event);
    }
    if (output.serverTick - this.lastSnapshotTick >= this.snapshotEveryTicks) {
      this.lastSnapshotTick = output.serverTick;
      for (const t of output.telemetry) {
        this.pendingTelemetry.set(t.vehicleId, { telemetry: t, serverTick: output.serverTick });
      }
    }
  }

  /**
   * Drain the queue to the DB. Safe to call after every ingest — re-entrancy is
   * guarded (a single in-flight drain), so overlapping calls coalesce. Never
   * throws; logs and clears on failure (the engine keeps the truth in memory).
   */
  async drain(): Promise<void> {
    if (this.draining) return;
    if (this.pendingEvents.size === 0 && this.pendingTelemetry.size === 0) return;
    this.draining = true;

    const eventsBatch = [...this.pendingEvents.values()];
    const telemetryBatch = [...this.pendingTelemetry.values()];
    this.pendingEvents = new Map();
    this.pendingTelemetry = new Map();

    try {
      if (eventsBatch.length > 0) {
        await this.writeEvents(eventsBatch);
      }
      if (telemetryBatch.length > 0) {
        await this.writeTelemetry(telemetryBatch);
      }
      this.drainCount += 1;
      if (this.drainCount % this.sweepEveryDrains === 0) {
        await this.sweepEvents();
      }
    } catch (err) {
      this.log.error({ err }, 'event sink drain failed (engine state is unaffected)');
    } finally {
      this.draining = false;
    }
  }

  private async writeEvents(batch: readonly SimEvent[]): Promise<void> {
    const rows = batch.map((e) => ({
      id: e.id,
      type: e.type,
      vehicleId: e.vehicleId,
      zoneId: e.zoneId,
      at: new Date(e.at),
      payload: e.payload,
    }));
    await this.db.insert(events).values(rows).onConflictDoNothing({ target: events.id });
  }

  private async writeTelemetry(batch: readonly PendingTelemetry[]): Promise<void> {
    const rows = batch.map(({ telemetry: t, serverTick }) => ({
      vehicleId: t.vehicleId,
      lat: t.lat,
      lng: t.lng,
      headingDeg: t.headingDeg,
      speedMps: t.speedMps,
      routeId: t.routeId,
      distanceAlongRouteM: t.distanceAlongRouteM,
      progress: t.progress,
      status: t.status,
      nextStopId: t.nextStopId,
      etaSeconds: t.etaSeconds,
      currentZoneId: t.currentZoneId,
      serverTick,
      updatedAt: new Date(),
    }));
    await this.db
      .insert(telemetrySnapshots)
      .values(rows)
      .onConflictDoUpdate({
        target: telemetrySnapshots.vehicleId,
        set: {
          lat: sql`excluded.lat`,
          lng: sql`excluded.lng`,
          headingDeg: sql`excluded.heading_deg`,
          speedMps: sql`excluded.speed_mps`,
          routeId: sql`excluded.route_id`,
          distanceAlongRouteM: sql`excluded.distance_along_route_m`,
          progress: sql`excluded.progress`,
          status: sql`excluded.status`,
          nextStopId: sql`excluded.next_stop_id`,
          etaSeconds: sql`excluded.eta_seconds`,
          currentZoneId: sql`excluded.current_zone_id`,
          serverTick: sql`excluded.server_tick`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  /**
   * Prune the events table to the most recent `maxEvents` rows (the bounded
   * window, ADR-005 C1). Deletes everything below the cutoff `seq` (the
   * bigserial monotonic order), so the feed stays small.
   */
  private async sweepEvents(): Promise<void> {
    // The `seq` of the Nth-newest row: everything below it is pruned. One
    // indexed scan (events_at_idx / the bigserial PK) with a single-row read.
    const boundary = await this.db
      .select({ seq: events.seq })
      .from(events)
      .orderBy(desc(events.seq))
      .limit(1)
      .offset(this.maxEvents - 1);
    const cutoff = boundary[0]?.seq;
    if (cutoff === undefined) return;
    await this.db.delete(events).where(lt(events.seq, cutoff));
  }
}
