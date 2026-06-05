import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIGURATOR_OPTIONS, getVehicleBySlug } from '@/mocks';

import { useReservationStore } from './reservation-store';

/**
 * Phase 7 (Task 7.1) — the configurator carry-over + deep-link seeding contract
 * (`/reserve?vehicle=<slug>&color=<id>&wheels=<id>`). The validation that the
 * wizard performs before seeding (catalog lookup, unknown params ignored — the
 * razors-edge rule) is exercised here against the REAL mock catalog, plus the
 * store's `seedFromDeepLink` / `configureAndReserve` behaviour.
 *
 * This mirrors `reservation-wizard.tsx`'s `WizardWithParams` seed-building logic
 * (kept inline there for the Suspense boundary); pinning it here guards the
 * contract without mounting the R3F-adjacent component tree.
 */

/** The exact seed-resolution the wizard runs over raw URL params. */
function resolveSeed(params: {
  vehicle?: string;
  color?: string;
  wheels?: string;
}): {
  vehicleId: string | undefined;
  config: { colorId: string; wheelId: string } | undefined;
} {
  const vehicle = params.vehicle ? getVehicleBySlug(params.vehicle) : undefined;
  const validColor =
    params.color && CONFIGURATOR_OPTIONS.colors.some((c) => c.id === params.color)
      ? params.color
      : undefined;
  const validWheel =
    params.wheels && CONFIGURATOR_OPTIONS.wheels.some((w) => w.id === params.wheels)
      ? params.wheels
      : undefined;
  return {
    vehicleId: vehicle?.id,
    config:
      validColor && validWheel ? { colorId: validColor, wheelId: validWheel } : undefined,
  };
}

beforeEach(() => {
  localStorage.clear();
  useReservationStore.setState({
    step: 'vehicle',
    extras: [],
    savedAt: 0,
    hydrated: true,
    notice: null,
    confirmation: null,
    vehicleId: undefined,
    config: undefined,
    range: undefined,
    pickupLocationId: undefined,
    returnLocationId: undefined,
    insuranceTier: undefined,
    driver: undefined,
  });
});

afterEach(() => { localStorage.clear(); });

describe('deep-link seed resolution — valid params', () => {
  it('resolves the flagship slug + valid colour/wheel to ids', () => {
    const seed = resolveSeed({ vehicle: 'lumen-gt', color: 'col-voltaic', wheels: 'whl-forged' });
    expect(seed.vehicleId).toBe('veh-lumen-gt');
    expect(seed.config).toEqual({ colorId: 'col-voltaic', wheelId: 'whl-forged' });
  });

  it('resolves a non-configurable fleet slug to its id, with no config', () => {
    const seed = resolveSeed({ vehicle: 'stratos' });
    expect(seed.vehicleId).toBe('veh-stratos-performance');
    expect(seed.config).toBeUndefined();
  });
});

describe('deep-link seed resolution — unknown / garbage params ignored', () => {
  it('ignores an unknown vehicle slug (no vehicle seeded)', () => {
    expect(resolveSeed({ vehicle: 'does-not-exist' }).vehicleId).toBeUndefined();
  });

  it('ignores a garbage colour id', () => {
    const seed = resolveSeed({ vehicle: 'lumen-gt', color: '"><script>', wheels: 'whl-forged' });
    expect(seed.vehicleId).toBe('veh-lumen-gt');
    expect(seed.config).toBeUndefined(); // colour invalid → no config (needs both)
  });

  it('ignores a garbage wheel id', () => {
    const seed = resolveSeed({ vehicle: 'lumen-gt', color: 'col-voltaic', wheels: '../../etc' });
    expect(seed.config).toBeUndefined();
  });

  it('ignores a colour without a wheel (config needs both)', () => {
    expect(resolveSeed({ vehicle: 'lumen-gt', color: 'col-voltaic' }).config).toBeUndefined();
  });

  it('resolves nothing for an empty param set', () => {
    expect(resolveSeed({})).toEqual({ vehicleId: undefined, config: undefined });
  });
});

describe('seedFromDeepLink — store behaviour', () => {
  it('seeds the vehicle + config and advances past the vehicle step', () => {
    useReservationStore.getState().seedFromDeepLink({
      vehicleId: 'veh-lumen-gt',
      config: { colorId: 'col-voltaic', wheelId: 'whl-forged' },
    });
    const s = useReservationStore.getState();
    expect(s.vehicleId).toBe('veh-lumen-gt');
    expect(s.config).toEqual({ colorId: 'col-voltaic', wheelId: 'whl-forged' });
    expect(s.step).toBe('dates-locations');
  });

  it('does NOT clobber an in-progress restored draft (only fills, keeps the step past vehicle)', () => {
    // Simulate a restored draft already on the extras step with a range.
    useReservationStore.setState({
      step: 'extras',
      vehicleId: 'veh-lumen-gt',
      range: { fromISODate: '2026-06-27', toISODate: '2026-06-30' },
      pickupLocationId: 'loc-lis-city',
      returnLocationId: 'loc-lis-airport',
      extras: ['ext-gps'],
    });
    useReservationStore.getState().seedFromDeepLink({
      vehicleId: 'veh-lumen-gt',
      config: { colorId: 'col-glacier', wheelId: 'whl-aero' },
    });
    const s = useReservationStore.getState();
    // Step is NOT reset back (only advanced from `vehicle`), range preserved.
    expect(s.step).toBe('extras');
    expect(s.range).toEqual({ fromISODate: '2026-06-27', toISODate: '2026-06-30' });
  });
});

describe('configureAndReserve — the configurator carry-over (the spine thread)', () => {
  it('writes vehicle + config and jumps to the dates step', () => {
    useReservationStore
      .getState()
      .configureAndReserve('veh-lumen-gt', { colorId: 'col-midnight', wheelId: 'whl-turbine' });
    const s = useReservationStore.getState();
    expect(s.vehicleId).toBe('veh-lumen-gt');
    expect(s.config).toEqual({ colorId: 'col-midnight', wheelId: 'whl-turbine' });
    expect(s.step).toBe('dates-locations');
    expect(s.confirmation).toBeNull();
  });
});
