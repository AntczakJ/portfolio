import { vehicleListSchema, type Vehicle } from '@/lib/schemas/vehicle';

import { SEED_FLEET } from './seed-data';

/**
 * Fleet mock accessor (Task 3.2).
 *
 * The static seed (baked from faker at authoring time — no faker on the
 * runtime path, ADR-002 §5) is parsed ONCE through the shared Zod schema. The
 * parse both validates the bake (a drifted seed fails fast in dev) and returns
 * a precisely-typed, mutable value. Determinism: the source is a fixed seed
 * file, so this is byte-stable across reloads.
 */
export const FLEET: readonly Vehicle[] = vehicleListSchema.parse(
  SEED_FLEET,
);

/** The single configurable hero vehicle (the LUMEN GT). */
export const HERO_VEHICLE: Vehicle = (() => {
  const hero = FLEET.find((v) => v.configurable);
  if (!hero) {
    throw new Error('Seed invariant violated: no configurable hero vehicle');
  }
  return hero;
})();

/** Look up a vehicle by slug (used by deep links + the fleet cards). */
export function getVehicleBySlug(slug: string): Vehicle | undefined {
  return FLEET.find((v) => v.slug === slug);
}

/** Look up a vehicle by id. */
export function getVehicleById(id: string): Vehicle | undefined {
  return FLEET.find((v) => v.id === id);
}
