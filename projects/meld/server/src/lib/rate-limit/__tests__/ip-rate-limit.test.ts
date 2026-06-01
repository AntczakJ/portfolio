/**
 * Per-IP fixed-window rate limit behaviour tests (Task 1.6).
 *
 * Exercises the load-bearing pieces of `IpRateLimit` and the
 * `extractClientIp` header parser:
 *
 *   - Allow up to cap; deny at the boundary; rejection counter advances.
 *   - Window snap: a request after `windowMs` reopens the window and
 *     resets the counter to 1.
 *   - `countFor` reads zero for IPs whose window has expired.
 *   - `extractClientIp` reads `x-forwarded-for` first-entry, trims,
 *     falls back to `'unknown'`.
 *
 * Uses Node's built-in `node:test` runner per the meld-server `test`
 * script (`node --test --import tsx`). No Vitest dep needed.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  BOARD_CREATE_RATE_LIMIT_PER_HOUR_DEFAULT,
  IpRateLimit,
  extractClientIp,
} from '../ip-rate-limit';

void describe('IpRateLimit', () => {
  void it('default cap matches the documented constant (30)', () => {
    const limit = new IpRateLimit();
    assert.equal(limit.cap, BOARD_CREATE_RATE_LIMIT_PER_HOUR_DEFAULT);
    assert.equal(BOARD_CREATE_RATE_LIMIT_PER_HOUR_DEFAULT, 30);
  });

  void it('allow returns true up to cap, then false', () => {
    const clock = 1_000_000;
    const limit = new IpRateLimit({
      cap: 3,
      windowMs: 60_000,
      now: () => clock,
    });
    const ip = '203.0.113.4';
    assert.equal(limit.allow(ip), true);
    assert.equal(limit.allow(ip), true);
    assert.equal(limit.allow(ip), true);
    assert.equal(limit.allow(ip), false);
    assert.equal(limit.countFor(ip), 3);
    assert.equal(limit.rejectedCount, 1);
  });

  void it('the window snaps to a fresh start once windowMs elapses', () => {
    let clock = 1_000_000;
    const limit = new IpRateLimit({
      cap: 2,
      windowMs: 60_000,
      now: () => clock,
    });
    const ip = '198.51.100.7';
    assert.equal(limit.allow(ip), true);
    assert.equal(limit.allow(ip), true);
    assert.equal(limit.allow(ip), false);
    // Advance past the window.
    clock += 60_001;
    assert.equal(limit.allow(ip), true);
    assert.equal(limit.countFor(ip), 1);
  });

  void it('countFor returns 0 for an expired window without resetting the bucket', () => {
    let clock = 1_000_000;
    const limit = new IpRateLimit({
      cap: 5,
      windowMs: 60_000,
      now: () => clock,
    });
    const ip = '192.0.2.99';
    limit.allow(ip);
    assert.equal(limit.countFor(ip), 1);
    clock += 60_001;
    assert.equal(limit.countFor(ip), 0);
  });

  void it('distinct IPs have independent buckets', () => {
    const limit = new IpRateLimit({ cap: 1, windowMs: 60_000 });
    assert.equal(limit.allow('203.0.113.1'), true);
    assert.equal(limit.allow('203.0.113.2'), true);
    assert.equal(limit.allow('203.0.113.1'), false);
    assert.equal(limit.allow('203.0.113.2'), false);
    assert.equal(limit.trackedIpCount, 2);
  });

  void it('rejectedCount is a process-lifetime monotonic counter', () => {
    const limit = new IpRateLimit({ cap: 1, windowMs: 60_000 });
    const ip = '203.0.113.42';
    limit.allow(ip);
    limit.allow(ip);
    limit.allow(ip);
    assert.equal(limit.rejectedCount, 2);
  });
});

void describe('extractClientIp', () => {
  function makeHeaders(map: Record<string, string>): {
    get(name: string): string | null;
  } {
    return {
      get(name: string): string | null {
        return map[name.toLowerCase()] ?? null;
      },
    };
  }

  void it('reads the first comma-separated entry of x-forwarded-for', () => {
    assert.equal(
      extractClientIp(
        makeHeaders({ 'x-forwarded-for': '203.0.113.1, 10.0.0.5' }),
      ),
      '203.0.113.1',
    );
  });

  void it('trims whitespace from the first entry', () => {
    assert.equal(
      extractClientIp(makeHeaders({ 'x-forwarded-for': '  198.51.100.7  ' })),
      '198.51.100.7',
    );
  });

  void it('returns "unknown" when x-forwarded-for is absent', () => {
    assert.equal(extractClientIp(makeHeaders({})), 'unknown');
  });

  void it('returns "unknown" when x-forwarded-for is empty', () => {
    assert.equal(
      extractClientIp(makeHeaders({ 'x-forwarded-for': '' })),
      'unknown',
    );
  });

  void it('returns "unknown" when the first entry is whitespace-only', () => {
    assert.equal(
      extractClientIp(makeHeaders({ 'x-forwarded-for': '   , 203.0.113.1' })),
      'unknown',
    );
  });
});
