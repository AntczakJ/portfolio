import { describe, expect, it } from 'vitest';

import { MAX_SEEK_TICK } from 'atlas-shared/schemas/ws';

import { buildBaseline } from '../baseline/build-baseline.js';
import { buildPortoFixture, fixtureToBaselineInput } from '../../seed/porto-fixture.js';
import { SimulationEngine, type EngineTickOutput } from './engine.js';

/**
 * Engine IO shell smoke tests (Task 3.2). The shell owns wall-clock; here we
 * INJECT a deterministic clock so the accumulator is exercised without real
 * time. We assert: the step path emits authoritative output, vehicles move, the
 * accumulator drains whole ticks from injected elapsed time, the control surface
 * (pause/resume/setSpeed) behaves, and seek re-folds deterministically.
 */

function makeEngine(nowRef: { value: number }): SimulationEngine {
  const baseline = buildBaseline(fixtureToBaselineInput(buildPortoFixture()));
  return new SimulationEngine(baseline, {
    now: () => nowRef.value,
    wakeMs: 1000,
  });
}

describe('SimulationEngine — step', () => {
  it('emits per-vehicle telemetry and advances the tick', () => {
    const nowRef = { value: 1_000_000 };
    const engine = makeEngine(nowRef);
    const outputs: EngineTickOutput[] = [];
    engine.onTick((o) => outputs.push(o));

    expect(engine.currentTick).toBe(0);
    const out = engine.step();
    expect(engine.currentTick).toBe(1);
    expect(out.serverTick).toBe(1);
    expect(out.telemetry.length).toBeGreaterThan(0);
    expect(outputs).toHaveLength(1);

    // Telemetry carries a stamped ISO `at` on any emitted events.
    for (const e of out.events) {
      expect(() => new Date(e.at).toISOString()).not.toThrow();
      expect(e.id.length).toBeGreaterThan(0);
    }
  });

  it('vehicles move across stepped ticks', () => {
    const nowRef = { value: 0 };
    const engine = makeEngine(nowRef);
    const first = engine.step().telemetry;
    for (let i = 0; i < 30; i += 1) engine.step();
    const later = engine.snapshot().telemetry;

    const firstById = new Map(first.map((t) => [t.vehicleId, t.distanceAlongRouteM]));
    let moved = 0;
    for (const t of later) {
      const s0 = firstById.get(t.vehicleId) ?? 0;
      if (Math.abs(t.distanceAlongRouteM - s0) > 5) moved += 1;
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe('SimulationEngine — accumulator (timer-driven)', () => {
  it('advances ticks from injected real time via the started loop', async () => {
    const nowRef = { value: 0 };
    const baseline = buildBaseline(fixtureToBaselineInput(buildPortoFixture()));
    // Small wake so the real setInterval fires quickly; the clock is injected so
    // elapsed-time -> ticks math is deterministic regardless of timer jitter.
    const engine = new SimulationEngine(baseline, { now: () => nowRef.value, wakeMs: 5 });
    const ticks: number[] = [];
    engine.onTick((o) => ticks.push(o.serverTick));

    engine.start();
    // Simulate ~3 s of real time passing between two wakeups (a late wakeup):
    // the accumulator should drain 3 whole 1 Hz ticks on the next wake.
    nowRef.value = 3000;
    await new Promise((r) => setTimeout(r, 30));
    engine.stop();

    expect(engine.currentTick).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
  });

  it('caps a catch-up burst after a long stall', async () => {
    const nowRef = { value: 0 };
    const baseline = buildBaseline(fixtureToBaselineInput(buildPortoFixture()));
    const engine = new SimulationEngine(baseline, {
      now: () => nowRef.value,
      wakeMs: 5,
      maxCatchUpTicks: 10,
    });
    engine.onTick(() => undefined);
    engine.start();
    // A huge stall: 10 minutes elapsed. The cap means at most 10 ticks advance
    // on the recovery wake, not 600.
    nowRef.value = 600_000;
    await new Promise((r) => setTimeout(r, 30));
    engine.stop();
    expect(engine.currentTick).toBeLessThanOrEqual(10);
  });
});

describe('SimulationEngine — control surface', () => {
  it('pause freezes the tick; resume continues from the same tick', () => {
    const nowRef = { value: 0 };
    const engine = makeEngine(nowRef);
    engine.step();
    engine.step();
    const atPause = engine.currentTick;
    engine.pause();
    expect(engine.isRunning).toBe(false);
    engine.resume();
    expect(engine.isRunning).toBe(true);
    expect(engine.currentTick).toBe(atPause);
  });

  it('setSpeed updates the multiplier (bounded non-negative)', () => {
    const nowRef = { value: 0 };
    const engine = makeEngine(nowRef);
    engine.setSpeed(4);
    expect(engine.currentSpeed).toBe(4);
    engine.setSpeed(-2);
    expect(engine.currentSpeed).toBe(0);
  });

  it('clamps a giant seek target to MAX_SEEK_TICK (no unbounded fold = no event-loop DoS)', () => {
    const nowRef = { value: 0 };
    const engine = makeEngine(nowRef);

    // A hostile target far past the cap (the P0 DoS frame). The engine must NOT
    // fold a billion times — it clamps to MAX_SEEK_TICK and the call returns
    // quickly. We also assert the resulting tick is exactly the cap, proving the
    // defensive clamp (not the schema) bounds the fold even when seek() is called
    // directly (schema bypassed).
    const started = Date.now();
    const snap = engine.seek(1_000_000_000);
    const elapsedMs = Date.now() - started;

    expect(snap.serverTick).toBe(MAX_SEEK_TICK);
    expect(engine.currentTick).toBe(MAX_SEEK_TICK);
    // A bounded fold of MAX_SEEK_TICK over the small Porto fleet is fast; a
    // billion-iteration fold would hang for minutes. Generous ceiling to stay
    // robust on slow CI.
    expect(elapsedMs).toBeLessThan(5000);
  });

  it('seek re-folds deterministically (seek == stepped run)', () => {
    const nowRef = { value: 0 };
    const a = makeEngine(nowRef);
    for (let i = 0; i < 50; i += 1) a.step();
    const stepped = a.snapshot().telemetry;

    const b = makeEngine(nowRef);
    const sought = b.seek(50).telemetry;

    const steppedById = new Map(stepped.map((t) => [t.vehicleId, t]));
    for (const t of sought) {
      const ref = steppedById.get(t.vehicleId);
      expect(ref).toBeDefined();
      expect(t.distanceAlongRouteM).toBe(ref?.distanceAlongRouteM);
      expect(t.status).toBe(ref?.status);
    }
  });
});
