import { describe, expect, it } from 'vitest';

import { buildStaticSnapshot } from '@/lib/fleet/static-snapshot';

/**
 * The static snapshot is the SSR floor's data source (Task 6.1 / 6.3). It must be
 * deterministic (no live dependency) and meaningful (a populated fleet + routes +
 * zones) so the no-JS page is never blank and Lighthouse scores from static HTML.
 */
describe('buildStaticSnapshot', () => {
  it('produces a populated, deterministic fleet snapshot', () => {
    const a = buildStaticSnapshot();
    const b = buildStaticSnapshot();

    expect(a.vehicleCount).toBeGreaterThan(0);
    expect(a.routeCount).toBeGreaterThan(0);
    expect(a.zoneCount).toBeGreaterThan(0);
    expect(a.rows).toHaveLength(a.vehicleCount);

    // Deterministic: two builds yield identical labels in identical order (the
    // no-JS floor must server-render identically every request).
    expect(a.rows.map((r) => r.label)).toEqual(b.rows.map((r) => r.label));
  });

  it('sorts rows by unit label naturally (Unit 2 before Unit 10)', () => {
    const { rows } = buildStaticSnapshot();
    const nums = rows.map((r) => Number(r.label.replace(/\D/g, '')));
    const sorted = [...nums].sort((x, y) => x - y);
    expect(nums).toEqual(sorted);
  });

  it('carries a human status label on every row (never status by colour alone)', () => {
    const { rows } = buildStaticSnapshot();
    for (const row of rows) {
      expect(row.statusLabel.length).toBeGreaterThan(0);
    }
  });

  it('formats route references with length, stop count and loop mode', () => {
    const { routes } = buildStaticSnapshot();
    for (const route of routes) {
      expect(route.name.length).toBeGreaterThan(0);
      expect(Number(route.lengthKm)).toBeGreaterThan(0);
      expect(route.stopCount).toBeGreaterThan(0);
      expect(['loop', 'ping_pong']).toContain(route.loopMode);
    }
  });
});
