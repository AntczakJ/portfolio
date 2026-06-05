/**
 * Reserved-dimension contract coverage (CLS fix).
 *
 * The load-bearing claim of `lib/layout/reserved.ts` is that every live
 * status-bar cell reserves a box at least as wide as its widest realistic
 * value, so the late-WebSocket-snapshot populate cannot grow a cell and
 * shift the bar. These tests pin that contract:
 *
 *   1. Every region maps to a `ch` reservation AND a Tailwind class.
 *   2. The `ch` reservation covers the widest content we documented for
 *      that cell (a regression that shrinks a reservation below its
 *      content — re-introducing the CLS — fails here).
 *   3. The Tailwind class is the STATIC `min-w-[…ch]` literal (no runtime
 *      interpolation that the JIT cannot see at build time), and its `ch`
 *      value matches `RESERVED_CH` so the two sources cannot drift.
 */
import { describe, expect, it } from 'vitest';

import {
  RESERVED_CH,
  reservedMinWidth,
  type ReservedRegion,
} from '../reserved';

/**
 * The widest realistic rendered string per region — what the cell must be
 * able to hold without growing. Kept here (not in the source) so the test
 * independently asserts the reservation covers the content rather than
 * trivially echoing the source's own number.
 */
const WIDEST_CONTENT: Record<ReservedRegion, string> = {
  apiLatency: '1234 ms', // 7 chars
  wsState: 'reconnecting', // 12 chars
  tickCount: '9,999,999', // 9 chars (grouped)
  lastTick: 'stale', // 5 chars ("0.0 s" is also 5)
};

const ALL_REGIONS = Object.keys(RESERVED_CH) as ReservedRegion[];

describe('reserved dimensions', () => {
  it('defines a reservation for every region', () => {
    expect(ALL_REGIONS.length).toBeGreaterThan(0);
    for (const region of ALL_REGIONS) {
      expect(RESERVED_CH[region]).toBeGreaterThan(0);
    }
  });

  it('reserves at least the widest content width per region', () => {
    for (const region of ALL_REGIONS) {
      const widest = WIDEST_CONTENT[region].length;
      expect(
        RESERVED_CH[region],
        `${region} reservation must cover "${WIDEST_CONTENT[region]}" (${String(widest)} ch)`,
      ).toBeGreaterThanOrEqual(widest);
    }
  });

  it('emits a static min-w-[…ch] class whose ch matches RESERVED_CH', () => {
    for (const region of ALL_REGIONS) {
      const cls = reservedMinWidth(region);
      expect(cls).toMatch(/^min-w-\[\d+ch\]$/);
      const ch = Number(/\[(\d+)ch\]/.exec(cls)?.[1]);
      expect(ch).toBe(RESERVED_CH[region]);
    }
  });
});
