import type { SpawnShape } from '@/lib/schemas';

/**
 * Pure particle-seed builders (ADR-002 §1 — the ONLY per-particle CPU work, done
 * ONCE at init, never per frame).
 *
 * - `buildReference(n)` → the static `reference` attribute (each vertex's sim-UV),
 *   so the render vertex shader can sample the sim textures per particle.
 * - `seedPositionData(n, shape, domain)` → the initial position texture data
 *   (xyz spawn position + a randomized age phase so respawns are de-synced).
 * - `seedVelocityData(n)` → the initial velocity texture data (near-zero xyz + a
 *   stable per-particle seed scalar in w).
 *
 * All deterministic given a seeded PRNG, so they are Vitest-coverable without a
 * GPU (Phase 7): we assert the array lengths, the UV layout, the domain bounds,
 * and the age-phase spread.
 */

/** A tiny deterministic PRNG (mulberry32) so seeding is reproducible + testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The spawn-shape discriminant the position shader switches on. */
export function spawnShapeToFloat(shape: SpawnShape): number {
  switch (shape) {
    case 'sphere':
      return 0;
    case 'box':
      return 1;
    case 'shell':
      return 2;
    case 'disc':
      return 3;
    default:
      return 0;
  }
}

/**
 * The static `reference` attribute: for each particle index i (of n²), the
 * sim-texel UV centre `((col+0.5)/n, (row+0.5)/n)`. Built once (ADR-002 §1).
 */
export function buildReference(n: number): Float32Array {
  const count = n * n;
  const ref = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const col = i % n;
    const row = Math.floor(i / n);
    ref[i * 2] = (col + 0.5) / n;
    ref[i * 2 + 1] = (row + 0.5) / n;
  }
  return ref;
}

/** Sample a spawn position for a shape, into the bounded domain. */
function sampleSpawn(
  shape: SpawnShape,
  domain: number,
  rnd: () => number,
): [number, number, number] {
  const rx = rnd() * 2 - 1;
  const ry = rnd() * 2 - 1;
  const rz = rnd() * 2 - 1;
  const len = Math.hypot(rx, ry, rz) || 1;
  const dx = rx / len;
  const dy = ry / len;
  const dz = rz / len;

  switch (shape) {
    case 'box':
      return [rx * domain, ry * domain, rz * domain];
    case 'shell':
      return [dx * domain, dy * domain, dz * domain];
    case 'disc': {
      const a = rnd() * Math.PI * 2;
      const t = Math.sqrt(rnd());
      return [Math.cos(a) * domain * t, ry * domain * 0.12, Math.sin(a) * domain * t];
    }
    case 'sphere':
    default: {
      const t = Math.cbrt(rnd());
      return [dx * domain * t, dy * domain * t, dz * domain * t];
    }
  }
}

/**
 * Seed the position texture data (RGBA per texel): xyz spawn position + a
 * randomized age phase in [0,1] in w (so respawns are de-synchronized — no
 * global pulsing, ADR-002 §1).
 */
export function seedPositionData(
  n: number,
  shape: SpawnShape,
  domain: number,
  seed = 1337,
): Float32Array {
  const count = n * n;
  const data = new Float32Array(count * 4);
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i += 1) {
    const [x, y, z] = sampleSpawn(shape, domain, rnd);
    data[i * 4] = x;
    data[i * 4 + 1] = y;
    data[i * 4 + 2] = z;
    data[i * 4 + 3] = rnd(); // age phase
  }
  return data;
}

/**
 * Seed the velocity texture data (RGBA per texel): near-zero xyz + a stable
 * per-particle seed scalar in w (used for size/phase variation + respawn hashing).
 */
export function seedVelocityData(n: number, seed = 7331): Float32Array {
  const count = n * n;
  const data = new Float32Array(count * 4);
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i += 1) {
    data[i * 4] = (rnd() - 0.5) * 0.02;
    data[i * 4 + 1] = (rnd() - 0.5) * 0.02;
    data[i * 4 + 2] = (rnd() - 0.5) * 0.02;
    data[i * 4 + 3] = rnd(); // stable seed scalar
  }
  return data;
}
