import type { Route, RouteStop, Vehicle, Zone } from 'atlas-shared/schemas';

import type { AtlasDb } from '../db/drizzle.js';
import { buildBaseline } from './baseline/build-baseline.js';
import type { SimBaseline } from './baseline/types.js';
import { EventSink, type EventSinkLogger, type EventSinkOptions } from './persistence/event-sink.js';
import {
  SimulationEngine,
  type EngineOptions,
  type EngineSnapshot,
  type EngineTickOutput,
} from './shell/engine.js';
import { buildPortoFixture, fixtureToBaselineInput } from '../seed/porto-fixture.js';

/**
 * The engine service (Task 3.2 / 3.3) — the composition root the Fastify app
 * registers. It owns:
 *
 *   - the FROZEN baseline (built once from the Porto fixture, ADR-002 B1);
 *   - the {@link SimulationEngine} (the IO shell driving the pure reducer);
 *   - the {@link EventSink} (the queued async persistence, off the tick hot path);
 *   - the STATIC DEFINITIONS (routes/stops/zones/vehicles) the WS `snapshot`
 *     frame (Phase 4) carries so a fresh client renders the map without a REST
 *     round trip.
 *
 * Wiring: on each tick, the shell emits output; the service forwards it to the
 * sink (synchronous enqueue) and kicks a fire-and-forget drain. The WS gateway
 * (Phase 4) subscribes via {@link onTick} and reads {@link snapshot} on connect.
 *
 * The definitions come from the SAME fixture that seeds the DB (seed.ts), so the
 * in-memory world and the persisted definitions never drift. (The service builds
 * its baseline from the fixture directly rather than reading the DB, so the
 * engine boots even before the seed runs — the DB is for the feed/snapshot
 * reads, not the engine's source of truth, ADR-005.)
 */

export interface EngineDefinitions {
  readonly vehicles: readonly Vehicle[];
  readonly routes: readonly Route[];
  readonly stops: readonly RouteStop[];
  readonly zones: readonly Zone[];
}

export interface EngineServiceOptions {
  readonly engine?: EngineOptions;
  readonly sink?: EventSinkOptions;
}

export class EngineService {
  readonly baseline: SimBaseline;
  readonly definitions: EngineDefinitions;
  private readonly engine: SimulationEngine;
  private readonly sink: EventSink;
  private unsubscribe: (() => void) | null = null;

  constructor(db: AtlasDb, log: EventSinkLogger, options: EngineServiceOptions = {}) {
    const fixture = buildPortoFixture();
    this.definitions = {
      vehicles: fixture.vehicles,
      routes: fixture.routes,
      stops: fixture.stops,
      zones: fixture.zones,
    };
    this.baseline = buildBaseline(fixtureToBaselineInput(fixture));
    this.engine = new SimulationEngine(this.baseline, options.engine);
    this.sink = new EventSink(db, log, options.sink);
  }

  /** Start the loop and wire the persistence sink. */
  start(): void {
    this.unsubscribe = this.engine.onTick((output) => {
      this.sink.ingest(output);
      void this.sink.drain();
    });
    this.engine.start();
  }

  /** Stop the loop and detach the sink. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.engine.stop();
    // Flush anything still queued so the last events/snapshot land.
    await this.sink.drain();
  }

  /** Subscribe to per-tick output (the WS gateway, Phase 4). */
  onTick(listener: (output: EngineTickOutput) => void): () => void {
    return this.engine.onTick(listener);
  }

  /** The current full-world snapshot telemetry (cold connect / reconnect). */
  snapshot(): EngineSnapshot {
    return this.engine.snapshot();
  }

  get currentTick(): number {
    return this.engine.currentTick;
  }

  get isRunning(): boolean {
    return this.engine.isRunning;
  }

  get currentSpeed(): number {
    return this.engine.currentSpeed;
  }

  // --- demo control surface (Task 5.4 / the WS sim.control frame) ----------

  pause(): void {
    this.engine.pause();
  }

  resume(): void {
    this.engine.resume();
  }

  setSpeed(multiplier: number): void {
    this.engine.setSpeed(multiplier);
  }

  /** Re-fold to a target tick (deterministic replay) and return the snapshot. */
  seek(tick: number): EngineSnapshot {
    return this.engine.seek(tick);
  }
}
