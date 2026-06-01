/**
 * Board routes tests (Task 1.6).
 *
 * Pure-logic coverage for `pickDefaultBoardName` — the route handler
 * itself touches Drizzle and Hocuspocus, both of which need real wiring
 * (Postgres + a live WS server) to exercise end-to-end. Integration
 * tests against a real Postgres are tracked in Phase 5 (test-engineer
 * suite); this file covers the deterministic, side-effect-free logic.
 *
 * The cycle-by-minute rule is load-bearing for the "two creates within
 * the same minute see the same name" UX — the tests pin the contract so
 * a future refactor of the list size or the cycle function does not
 * silently rotate the rhythm.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { pickDefaultBoardName } from '../boards';

void describe('pickDefaultBoardName', () => {
  void it('returns a non-empty string for the current wall clock', () => {
    const name = pickDefaultBoardName();
    assert.ok(typeof name === 'string');
    assert.ok(name.length > 0);
  });

  void it('cycles by minute-of-day with an 8-entry list', () => {
    // Minute 0 → idx 0, minute 1 → idx 1, ..., minute 7 → idx 7,
    // minute 8 → idx 0 again. We assert idempotency at each modulo
    // step rather than the literal string values so a future curation
    // edit (per the AGENT_NOTES.md append-only convention) does not
    // require a test rewrite.
    const at = (h: number, m: number): string => {
      const d = new Date(2026, 0, 1, h, m, 0, 0);
      return pickDefaultBoardName(d);
    };
    assert.equal(at(0, 0), at(0, 8));
    assert.equal(at(0, 1), at(0, 9));
    assert.equal(at(0, 7), at(0, 15));
    // Different minute-of-day must give a different (or same — at the
    // modulo boundary) deterministic result.
    assert.equal(at(0, 0), at(0, 0));
  });

  void it('is deterministic for the same minute', () => {
    const d = new Date(2026, 4, 31, 14, 30, 0, 0);
    assert.equal(pickDefaultBoardName(d), pickDefaultBoardName(d));
  });

  void it('returns names within the documented length budget (<= 16 chars)', () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m++) {
        seen.add(pickDefaultBoardName(new Date(2026, 0, 1, h, m, 0, 0)));
      }
    }
    // 8 distinct names by design.
    assert.equal(seen.size, 8);
    for (const name of seen) {
      assert.ok(
        name.length <= 16,
        `name "${name}" exceeds 16-char share-dialog budget`,
      );
      assert.ok(name.length > 0);
    }
  });
});
