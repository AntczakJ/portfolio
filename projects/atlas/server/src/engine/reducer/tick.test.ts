import { describe, expect, it } from 'vitest';

import { buildBaseline } from '../baseline/build-baseline.js';
import type { SimBaseline } from '../baseline/types.js';
import { buildPortoFixture, fixtureToBaselineInput } from '../../seed/porto-fixture.js';
import { tick, telemetryFor } from './tick.js';
import { createInitialWorldState, type WorldState } from './world-state.js';

/**
 * Phase 3 reducer smoke / sanity tests (the heavy suite is Task 8.1). These pin
 * the load-bearing invariants now:
 *   - DETERMINISM: same baseline + N ticks -> the same world (fold-to-N equals
 *     run-to-N), the ADR-002 seek/replay guarantee.
 *   - MOTION: vehicles actually advance their distance-along-route over ticks.
 *   - PURITY: the reducer does not mutate its input WorldState.
 *   - GEOFENCE: a vehicle crossing a zone fires exactly one enter and the
 *     hysteresis confirms it (no flap), with stable event identity on replay.
 */

const DT = 1; // 1 Hz authoritative tick (ADR-002).

function fixtureBaseline(): SimBaseline {
  return buildBaseline(fixtureToBaselineInput(buildPortoFixture()));
}

function fold(baseline: SimBaseline, n: number): WorldState {
  let state = createInitialWorldState(baseline);
  for (let i = 0; i < n; i += 1) {
    state = tick(baseline, state, DT).state;
  }
  return state;
}

describe('tick reducer — determinism', () => {
  it('same baseline + N ticks reproduces the same world (fold-to-N is exact)', () => {
    const baseline = fixtureBaseline();
    const a = fold(baseline, 120);
    const b = fold(baseline, 120);

    expect(a.tick).toBe(120);
    expect(b.tick).toBe(120);
    expect(a.prng).toEqual(b.prng);
    for (const vehicle of baseline.vehicles) {
      const va = a.vehicles.get(vehicle.id);
      const vb = b.vehicles.get(vehicle.id);
      expect(va).toBeDefined();
      expect(va?.s).toBe(vb?.s);
      expect(va?.speedMps).toBe(vb?.speedMps);
      expect(va?.status).toBe(vb?.status);
      expect(va?.currentZoneId).toBe(vb?.currentZoneId);
    }
  });

  it('a fold from the baseline equals continuing a live run (seek == replay)', () => {
    const baseline = fixtureBaseline();
    // Live run to tick 80.
    let live = createInitialWorldState(baseline);
    for (let i = 0; i < 80; i += 1) live = tick(baseline, live, DT).state;
    // Independent fold to tick 80.
    const replay = fold(baseline, 80);
    for (const vehicle of baseline.vehicles) {
      expect(live.vehicles.get(vehicle.id)?.s).toBe(replay.vehicles.get(vehicle.id)?.s);
    }
  });
});

describe('tick reducer — purity', () => {
  it('does not mutate the input WorldState', () => {
    const baseline = fixtureBaseline();
    const before = createInitialWorldState(baseline);
    const firstVehicle = baseline.vehicles[0];
    expect(firstVehicle).toBeDefined();
    const sBefore = before.vehicles.get(firstVehicle?.id ?? '')?.s;
    const result = tick(baseline, before, DT);
    // The input is unchanged; the returned state is new.
    expect(before.tick).toBe(0);
    expect(result.state.tick).toBe(1);
    expect(before.vehicles.get(firstVehicle?.id ?? '')?.s).toBe(sBefore);
    expect(result.state).not.toBe(before);
  });
});

describe('tick reducer — motion', () => {
  it('vehicles advance their distance-along-route over ticks', () => {
    const baseline = fixtureBaseline();
    const start = createInitialWorldState(baseline);
    const after = fold(baseline, 30);
    let moved = 0;
    for (const vehicle of baseline.vehicles) {
      const s0 = start.vehicles.get(vehicle.id)?.s ?? 0;
      const s1 = after.vehicles.get(vehicle.id)?.s ?? 0;
      // Either advanced, wrapped, or dwelling — but at least one vehicle must
      // have genuinely moved a meaningful distance.
      if (Math.abs(s1 - s0) > 5) moved += 1;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('produces valid telemetry (lat/lng in Porto, heading in range)', () => {
    const baseline = fixtureBaseline();
    const state = fold(baseline, 10);
    for (const vehicle of baseline.vehicles) {
      const vs = state.vehicles.get(vehicle.id);
      expect(vs).toBeDefined();
      if (vs === undefined) continue;
      const t = telemetryFor(baseline, vs);
      expect(t.lat).toBeGreaterThan(41.13);
      expect(t.lat).toBeLessThan(41.17);
      expect(t.lng).toBeGreaterThan(-8.65);
      expect(t.lng).toBeLessThan(-8.58);
      expect(t.headingDeg).toBeGreaterThanOrEqual(0);
      expect(t.headingDeg).toBeLessThan(360);
      expect(t.progress).toBeGreaterThanOrEqual(0);
      expect(t.progress).toBeLessThanOrEqual(1);
    }
  });
});

describe('tick reducer — geofence', () => {
  it('fires geofence enter/exit events over a run, deterministically', () => {
    const baseline = fixtureBaseline();
    let state = createInitialWorldState(baseline);
    const enters: string[] = [];
    const exits: string[] = [];
    // Run long enough that vehicles traverse their routes and cross zones.
    for (let i = 0; i < 600; i += 1) {
      const result = tick(baseline, state, DT);
      state = result.state;
      for (const e of result.events) {
        if (e.type === 'geofence.enter') enters.push(`${e.vehicleId}:${String(e.tick)}:${e.zoneId ?? ''}`);
        if (e.type === 'geofence.exit') exits.push(`${e.vehicleId}:${String(e.tick)}:${e.zoneId ?? ''}`);
      }
    }
    // At least one genuine geofence crossing fired (the wow beat exists).
    expect(enters.length).toBeGreaterThan(0);

    // No-flap / determinism: re-running the same fold yields the SAME event
    // stream (same ids, same ticks) — the hysteresis is stable and seeded.
    let replay = createInitialWorldState(baseline);
    const entersReplay: string[] = [];
    for (let i = 0; i < 600; i += 1) {
      const result = tick(baseline, replay, DT);
      replay = result.state;
      for (const e of result.events) {
        if (e.type === 'geofence.enter') entersReplay.push(`${e.vehicleId}:${String(e.tick)}:${e.zoneId ?? ''}`);
      }
    }
    expect(entersReplay).toEqual(enters);
  });

  it('does not fire duplicate consecutive enters for the same (vehicle, zone)', () => {
    const baseline = fixtureBaseline();
    let state = createInitialWorldState(baseline);
    // Track the confirmed-inside set; an enter must only fire when transitioning
    // outside->inside, never twice in a row for the same pair.
    const lastTransition = new Map<string, 'enter' | 'exit'>();
    for (let i = 0; i < 800; i += 1) {
      const result = tick(baseline, state, DT);
      state = result.state;
      for (const e of result.events) {
        if (e.type !== 'geofence.enter' && e.type !== 'geofence.exit') continue;
        const key = `${e.vehicleId}:${e.zoneId ?? ''}`;
        const prev = lastTransition.get(key);
        const kind = e.type === 'geofence.enter' ? 'enter' : 'exit';
        // Never two enters (or two exits) in a row without the opposite between.
        expect(prev).not.toBe(kind);
        lastTransition.set(key, kind);
      }
    }
  });
});
