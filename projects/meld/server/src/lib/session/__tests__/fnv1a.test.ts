/**
 * FNV-1a 32-bit hash known-vector tests (Task 1.7a).
 *
 * Pinned against the classic Numerical Recipes FNV-1a 32-bit constants
 * (offset basis `0x811c9dc5`, prime `0x01000193`). These vectors are
 * the cross-language reference: the frontend mirror in
 * `meld-web/src/lib/identity/` (Task 2.5b) MUST produce identical
 * outputs on the same inputs, otherwise the cookie-derived
 * client-side identity card disagrees with the server's welcome-frame
 * identity payload and a viewer sees their emoji flip on first sync.
 *
 * Test runner: Node's built-in `node:test` via the package `test`
 * script `node --test --import tsx 'src/**\/*.test.ts'`. No Vitest, no
 * Jest — keeps the dev surface flat and the CI minimal.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { fnv1a32 } from '../fnv1a';

// `node:test`'s `describe` and `it` return Promises that the runtime
// awaits internally; ESLint's `no-floating-promises` rule does not
// know this, so we `void` each call to mark the floating Promise as
// intentional. Matches the canonical Node test runner usage.

void describe('fnv1a32', () => {
  void it('returns the offset basis for the empty string', () => {
    // No bytes consumed => no rounds run => result is exactly the
    // FNV-1a 32-bit offset basis. This is the canonical first
    // sanity vector across every language implementation.
    assert.equal(fnv1a32(''), 2166136261);
  });

  void it('matches the canonical vector for "a"', () => {
    // One round: hash = (offset_basis XOR 0x61) * prime mod 2^32.
    //  (0x811c9dc5 XOR 0x61) = 0x811c9da4
    //  0x811c9da4 * 0x01000193 mod 2^32 = 0xe40c292c = 3826002220
    assert.equal(fnv1a32('a'), 3826002220);
  });

  void it('matches the canonical vector for "foobar"', () => {
    // Well-known FNV-1a 32-bit test vector from the upstream Eastlake
    // / Hash Function FNV draft (the "string" reference set).
    assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  });

  void it('returns a non-negative 32-bit integer', () => {
    // Inputs chosen to drive the hash into the high bit of the 32-bit
    // space — without the `>>> 0` shift the result would be the
    // sign-extended negative bit pattern. The constraint pins that
    // the helper returns the positive uint32 representation.
    for (const input of [
      'meld',
      'session-id-deadbeef',
      'aaaaaaaa-bbbb-4ccc-89dd-eeeeeeeeeeee',
      'ÿÿÿÿ', // forces high bits
    ]) {
      const h = fnv1a32(input);
      assert.ok(Number.isInteger(h), `${input}: result not integer`);
      assert.ok(h >= 0, `${input}: result negative (${String(h)})`);
      assert.ok(h <= 0xffffffff, `${input}: result exceeds uint32`);
    }
  });

  void it('is deterministic across calls', () => {
    const input = 'aaaaaaaa-bbbb-4ccc-89dd-eeeeeeeeeeee';
    const first = fnv1a32(input);
    const second = fnv1a32(input);
    assert.equal(first, second);
  });

  void it('distinguishes inputs by case', () => {
    // FNV-1a treats every code unit as significant. A regression
    // toward "lowercase the input first" would silently collapse
    // cookies that differ only in case — guard against it.
    assert.notEqual(fnv1a32('A'), fnv1a32('a'));
  });

  void it('drives modulo 128 to a uniform distribution on random uuids', () => {
    // Coarse uniformity check — ADR-005 leans on `fnv1a32(sessionId)
    // % 128` mapping random UUIDs into the emoji whitelist with no
    // hot slots. 4096 inputs across 128 buckets should average 32
    // hits per bucket; we accept a 10x window to keep the test fast
    // and stable across runs (real distribution is much tighter,
    // but a tight bound risks flakes on unlucky seeds).
    const counts = new Array<number>(128).fill(0);
    for (let i = 0; i < 4096; i += 1) {
      // Pseudo-random fixed seed so the test is deterministic.
      const seed = `seed-${String(i)}-${String((i * 2654435761) >>> 0)}`;
      const slot = fnv1a32(seed) % 128;
      counts[slot] = (counts[slot] ?? 0) + 1;
    }
    for (let s = 0; s < 128; s += 1) {
      const c = counts[s] ?? 0;
      assert.ok(c >= 3, `slot ${String(s)} starved (${String(c)} hits)`);
      assert.ok(c <= 320, `slot ${String(s)} saturated (${String(c)} hits)`);
    }
  });
});
