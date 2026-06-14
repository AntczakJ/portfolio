import { describe, expect, it } from 'vitest';

import {
  buildReference,
  mulberry32,
  seedPositionData,
  seedVelocityData,
  spawnShapeToFloat,
} from './particle-seed';

describe('particle-seed (pure init — the only per-particle CPU work, once)', () => {
  describe('mulberry32', () => {
    it('is deterministic for a fixed seed', () => {
      const a = mulberry32(42);
      const b = mulberry32(42);
      for (let i = 0; i < 5; i += 1) expect(a()).toBe(b());
    });

    it('produces values in [0, 1)', () => {
      const rnd = mulberry32(1);
      for (let i = 0; i < 1000; i += 1) {
        const v = rnd();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('spawnShapeToFloat', () => {
    it('maps every shape to a stable discriminant', () => {
      expect(spawnShapeToFloat('sphere')).toBe(0);
      expect(spawnShapeToFloat('box')).toBe(1);
      expect(spawnShapeToFloat('shell')).toBe(2);
      expect(spawnShapeToFloat('disc')).toBe(3);
    });
  });

  describe('buildReference', () => {
    it('builds n*n UVs with the texel-centre layout', () => {
      const n = 4;
      const ref = buildReference(n);
      expect(ref.length).toBe(n * n * 2);
      // particle 0 -> (0.5/4, 0.5/4)
      expect(ref[0]).toBeCloseTo(0.125);
      expect(ref[1]).toBeCloseTo(0.125);
      // particle 5 -> col 1, row 1 -> (1.5/4, 1.5/4)
      expect(ref[5 * 2]).toBeCloseTo(0.375);
      expect(ref[5 * 2 + 1]).toBeCloseTo(0.375);
      // last particle -> col 3, row 3 -> (3.5/4, 3.5/4)
      expect(ref[(n * n - 1) * 2]).toBeCloseTo(0.875);
      expect(ref[(n * n - 1) * 2 + 1]).toBeCloseTo(0.875);
    });

    it('keeps every UV inside (0, 1)', () => {
      const ref = buildReference(8);
      for (const v of ref) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('seedPositionData', () => {
    it('has 4 channels per texel and a randomized age phase in [0,1)', () => {
      const n = 8;
      const data = seedPositionData(n, 'sphere', 3, 99);
      expect(data.length).toBe(n * n * 4);
      for (let i = 0; i < n * n; i += 1) {
        const age = data[i * 4 + 3]!;
        expect(age).toBeGreaterThanOrEqual(0);
        expect(age).toBeLessThan(1);
      }
    });

    it('keeps sphere/shell spawns within the domain radius', () => {
      const n = 16;
      const domain = 2.5;
      for (const shape of ['sphere', 'shell'] as const) {
        const data = seedPositionData(n, shape, domain, 7);
        for (let i = 0; i < n * n; i += 1) {
          const x = data[i * 4]!;
          const y = data[i * 4 + 1]!;
          const z = data[i * 4 + 2]!;
          const r = Math.hypot(x, y, z);
          expect(r).toBeLessThanOrEqual(domain + 1e-4);
        }
      }
    });

    it('keeps box spawns within the domain half-extent per axis', () => {
      const n = 12;
      const domain = 2;
      const data = seedPositionData(n, 'box', domain, 3);
      for (let i = 0; i < n * n; i += 1) {
        expect(Math.abs(data[i * 4]!)).toBeLessThanOrEqual(domain + 1e-4);
        expect(Math.abs(data[i * 4 + 1]!)).toBeLessThanOrEqual(domain + 1e-4);
        expect(Math.abs(data[i * 4 + 2]!)).toBeLessThanOrEqual(domain + 1e-4);
      }
    });

    it('is deterministic for a fixed seed', () => {
      const a = seedPositionData(8, 'box', 3, 5);
      const b = seedPositionData(8, 'box', 3, 5);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it('de-synchronizes age phases (not all identical)', () => {
      const data = seedPositionData(16, 'sphere', 3, 11);
      const ages = new Set<number>();
      for (let i = 0; i < 16 * 16; i += 1) ages.add(data[i * 4 + 3]!);
      expect(ages.size).toBeGreaterThan(100);
    });
  });

  describe('seedVelocityData', () => {
    it('has near-zero velocity + a stable seed scalar in [0,1)', () => {
      const n = 8;
      const data = seedVelocityData(n, 21);
      expect(data.length).toBe(n * n * 4);
      for (let i = 0; i < n * n; i += 1) {
        expect(Math.abs(data[i * 4]!)).toBeLessThanOrEqual(0.01);
        const seed = data[i * 4 + 3]!;
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThan(1);
      }
    });
  });
});
