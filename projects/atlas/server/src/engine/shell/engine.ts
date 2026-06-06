import { EventEmitter } from 'node:events';

import type { SimEvent, VehicleTelemetry } from 'atlas-shared/schemas';

import type { SimBaseline } from '../baseline/types.js';
import type { ReducerEvent } from '../reducer/events.js';
import { tick, telemetryFor, type TickResult } from '../reducer/tick.js';
import {
  createInitialWorldState,
  type VehicleState,
  type WorldState,
} from '../reducer/world-state.js';

/**
 * The engine IO shell (ADR-002 / ADR-007) — the in-process, single-instance loop
 * that drives the PURE reducer. THIS is where wall-clock, the interval, and side
 * effects live; the reducer stays pure. The shell:
 *
 *   - owns the FIXED-DT ACCUMULATOR (ADR-002 C3): it wakes on a timer, computes
 *     how many whole fixed-`dt` ticks of real time have elapsed (scaled by the
 *     demo speed multiplier), and folds the reducer that many times. A late
 *     wakeup advances whole ticks to catch up — variable wall-clock delta NEVER
 *     feeds the reducer `dt` (that would break reproducibility). A MAX-CATCH-UP
 *     CAP bounds a burst after a stall (skip to near-real-time, do not replay a
 *     huge backlog live);
 *   - applies each tick to the live WorldState and EMITS the per-vehicle
 *     telemetry + the stamped SimEvents to subscribers (the WS gateway in
 *     Phase 4 and the persistence sink in Task 3.3) via an in-memory emitter —
 *     NO broker (ADR-007);
 *   - exposes the demo CONTROL SURFACE: pause / resume / setSpeed / seek. `seek`
 *     leverages determinism — it re-folds the reducer from the baseline to the
 *     target tick (a pure replay), so the wow beats reproduce on demand.
 *
 * The reducer/shell boundary is clean: the shell never reaches into the
 * reducer's math, and the reducer never reads the clock. Promoting the loop to a
 * split worker later (v2) is a shell change, not a domain change.
 */

/** A tick's authoritative output, ready for the WS gateway. */
export interface EngineTickOutput {
  readonly serverTick: number;
  /** Wall-clock emit time, epoch milliseconds. */
  readonly ts: number;
  /** Per-vehicle telemetry for EVERY vehicle (the gateway deltas as it sees fit). */
  readonly telemetry: readonly VehicleTelemetry[];
  /** The events that fired this tick, stamped with id + ISO `at`. */
  readonly events: readonly SimEvent[];
}

/** A full-world snapshot, for a cold connect / reconnect / seek result. */
export interface EngineSnapshot {
  readonly serverTick: number;
  readonly ts: number;
  readonly telemetry: readonly VehicleTelemetry[];
}

/** The shell's typed event channel (in-memory, no broker). */
export interface EngineEvents {
  tick: [EngineTickOutput];
}

/**
 * A monotonic stream sequence shared across the engine's outputs is owned by the
 * gateway (per-connection), not here — the shell emits `serverTick`, the gateway
 * assigns `seq`. The shell only owns the authoritative tick index + wall-clock.
 */
export interface EngineOptions {
  /** Wall-clock source — injectable so tests drive time deterministically. */
  readonly now?: () => number;
  /**
   * Real milliseconds between accumulator wakeups. Defaults to the tick length
   * so at 1x speed the loop wakes ~once per authoritative tick.
   */
  readonly wakeMs?: number;
  /** Max whole ticks to advance in a single wakeup after a stall (the cap). */
  readonly maxCatchUpTicks?: number;
}

const DEFAULT_MAX_CATCH_UP_TICKS = 30;

export class SimulationEngine {
  private readonly baseline: SimBaseline;
  private readonly emitter = new EventEmitter();
  private readonly now: () => number;
  private readonly wakeMs: number;
  private readonly maxCatchUpTicks: number;
  private readonly dtSeconds: number;

  private state: WorldState;
  private running = false;
  private speedMultiplier = 1;
  private timer: NodeJS.Timeout | null = null;
  /** Wall-clock accumulator: real ms not yet converted into ticks. */
  private accumulatorMs = 0;
  private lastWakeAt: number;

  constructor(baseline: SimBaseline, options: EngineOptions = {}) {
    this.baseline = baseline;
    this.now = options.now ?? Date.now;
    this.wakeMs = options.wakeMs ?? baseline.tickMs;
    this.maxCatchUpTicks = options.maxCatchUpTicks ?? DEFAULT_MAX_CATCH_UP_TICKS;
    this.dtSeconds = baseline.tickMs / 1000;
    this.state = createInitialWorldState(baseline);
    this.lastWakeAt = this.now();
  }

  /** The current authoritative tick index. */
  get currentTick(): number {
    return this.state.tick;
  }

  /** Whether the loop is advancing. */
  get isRunning(): boolean {
    return this.running;
  }

  /** The current demo speed multiplier (ticks per real tick-interval). */
  get currentSpeed(): number {
    return this.speedMultiplier;
  }

  /** Subscribe to per-tick output (the WS gateway + persistence sink). */
  onTick(listener: (output: EngineTickOutput) => void): () => void {
    this.emitter.on('tick', listener);
    return () => {
      this.emitter.off('tick', listener);
    };
  }

  /** Build a full-world snapshot of the CURRENT state (cold connect / reconnect). */
  snapshot(): EngineSnapshot {
    return {
      serverTick: this.state.tick,
      ts: this.now(),
      telemetry: this.allTelemetry(this.state),
    };
  }

  /** Start the loop (idempotent). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastWakeAt = this.now();
    this.accumulatorMs = 0;
    this.timer = setInterval(() => {
      this.onWake();
    }, this.wakeMs);
    // Do not keep the process alive solely for the engine in tests.
    this.timer.unref();
  }

  /** Pause the loop — state is frozen; resume continues from the same tick. */
  pause(): void {
    this.running = false;
  }

  /** Resume the loop after a pause (does not reset the accumulator wildly). */
  resume(): void {
    if (this.running) return;
    this.running = true;
    this.lastWakeAt = this.now();
    this.accumulatorMs = 0;
  }

  /** Fully stop the loop and clear the timer. */
  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Set the demo speed multiplier (ticks-per-real-second scaling in the SHELL,
   * never the reducer `dt` — ADR-002 C3). Bounded sane by the caller (the WS
   * control frame caps it at 16).
   */
  setSpeed(multiplier: number): void {
    this.speedMultiplier = Math.max(0, multiplier);
  }

  /**
   * Seek to an absolute tick index by re-folding the reducer from the baseline
   * (a pure replay — the determinism payoff). Emits the resulting snapshot-class
   * tick output. Seeking BACKWARD or FORWARD both re-fold from tick 0 so the
   * result is exact regardless of the live path taken.
   */
  seek(targetTick: number): EngineSnapshot {
    const target = Math.max(0, Math.floor(targetTick));
    let state = createInitialWorldState(this.baseline);
    for (let i = 0; i < target; i += 1) {
      state = tick(this.baseline, state, this.dtSeconds).state;
    }
    this.state = state;
    return {
      serverTick: state.tick,
      ts: this.now(),
      telemetry: this.allTelemetry(state),
    };
  }

  /**
   * Advance exactly ONE tick and emit its output. Public so tests (and a future
   * manual stepper) can drive the engine deterministically without the timer.
   */
  step(): EngineTickOutput {
    const result = tick(this.baseline, this.state, this.dtSeconds);
    this.state = result.state;
    const output = this.toOutput(result);
    this.emitter.emit('tick', output);
    return output;
  }

  /** The accumulator wakeup: convert elapsed real time into whole ticks. */
  private onWake(): void {
    if (!this.running) return;
    const now = this.now();
    const elapsed = now - this.lastWakeAt;
    this.lastWakeAt = now;
    if (this.speedMultiplier <= 0) return;

    // Scale real elapsed by the demo speed, accumulate, and drain whole ticks.
    this.accumulatorMs += elapsed * this.speedMultiplier;
    let ticksToRun = Math.floor(this.accumulatorMs / this.baseline.tickMs);
    if (ticksToRun <= 0) return;

    // Cap the burst after a stall: skip to near-real-time rather than replay a
    // huge backlog live (ADR-002 shell guard).
    if (ticksToRun > this.maxCatchUpTicks) {
      ticksToRun = this.maxCatchUpTicks;
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs -= ticksToRun * this.baseline.tickMs;
    }

    for (let i = 0; i < ticksToRun; i += 1) {
      this.step();
    }
  }

  private toOutput(result: TickResult): EngineTickOutput {
    return {
      serverTick: result.state.tick,
      ts: this.now(),
      telemetry: this.allTelemetry(result.state),
      events: result.events.map((e) => this.stampEvent(e)),
    };
  }

  private allTelemetry(state: WorldState): VehicleTelemetry[] {
    const out: VehicleTelemetry[] = [];
    for (const vehicle of this.baseline.vehicles) {
      const vehicleState = state.vehicles.get(vehicle.id);
      if (vehicleState !== undefined) {
        out.push(telemetryFor(this.baseline, vehicleState));
      }
    }
    return out;
  }

  /**
   * Stamp a reducer event with a stable id + an ISO `at` derived from wall-clock
   * (the impurity the reducer deliberately omits). The id is
   * `vehicleId:tick:type[:zoneId]` — stable across a replay of the same tick, so
   * a seek does not mint a duplicate-but-different id.
   */
  private stampEvent(event: ReducerEvent): SimEvent {
    const idParts = [event.vehicleId, String(event.tick), event.type];
    if (event.zoneId !== null) idParts.push(event.zoneId);
    return {
      id: idParts.join(':'),
      type: event.type,
      vehicleId: event.vehicleId,
      zoneId: event.zoneId,
      at: new Date(this.now()).toISOString(),
      payload: event.payload,
    };
  }
}

export type { VehicleState };
