/**
 * Per-IP WS rate-limit behaviour tests — Phase 6 deploy hardening.
 *
 * Exercises the load-bearing pieces of `WSRateLimit`:
 *
 *   - Allow then deny at the cap boundary.
 *   - Release decrements; a released slot is reusable.
 *   - Idempotent release does not underflow.
 *   - The rejection counter is process-lifetime cumulative.
 *   - The map prunes zero-count entries so memory does not creep.
 *   - Env override resolution honours typos by falling back to the
 *     default — never silently uncaps the limiter.
 */

import { describe, expect, test } from 'bun:test';

import {
  WSRateLimit,
  WS_MAX_CONNECTIONS_PER_IP_DEFAULT,
} from '../rate-limit';

describe('WSRateLimit', () => {
  test('default cap matches the documented constant', () => {
    const limit = new WSRateLimit();
    expect(limit.cap).toBe(WS_MAX_CONNECTIONS_PER_IP_DEFAULT);
    expect(WS_MAX_CONNECTIONS_PER_IP_DEFAULT).toBe(5);
  });

  test('allow returns true up to cap, then false', () => {
    const limit = new WSRateLimit({ cap: 3 });
    const ip = '203.0.113.4';
    expect(limit.allow(ip)).toBe(true);
    expect(limit.allow(ip)).toBe(true);
    expect(limit.allow(ip)).toBe(true);
    expect(limit.allow(ip)).toBe(false);
    expect(limit.countFor(ip)).toBe(3);
    expect(limit.rateLimitedCount).toBe(1);
  });

  test('release decrements; the released slot is reusable', () => {
    const limit = new WSRateLimit({ cap: 2 });
    const ip = '198.51.100.7';
    expect(limit.allow(ip)).toBe(true);
    expect(limit.allow(ip)).toBe(true);
    expect(limit.allow(ip)).toBe(false);
    limit.release(ip);
    expect(limit.countFor(ip)).toBe(1);
    expect(limit.allow(ip)).toBe(true);
    expect(limit.countFor(ip)).toBe(2);
  });

  test('release prunes the entry when the count hits zero', () => {
    const limit = new WSRateLimit({ cap: 2 });
    const ip = '192.0.2.99';
    limit.allow(ip);
    limit.allow(ip);
    expect(limit.trackedIpCount).toBe(1);
    limit.release(ip);
    limit.release(ip);
    expect(limit.trackedIpCount).toBe(0);
    expect(limit.countFor(ip)).toBe(0);
  });

  test('release is idempotent against duplicate close paths', () => {
    const limit = new WSRateLimit({ cap: 1 });
    const ip = '203.0.113.5';
    limit.allow(ip);
    limit.release(ip);
    limit.release(ip); // duplicate must not underflow
    limit.release(ip);
    expect(limit.countFor(ip)).toBe(0);
    expect(limit.allow(ip)).toBe(true);
  });

  test('per-IP isolation — busy IP does not affect a quiet one', () => {
    const limit = new WSRateLimit({ cap: 2 });
    const busy = '203.0.113.10';
    const quiet = '198.51.100.11';
    limit.allow(busy);
    limit.allow(busy);
    expect(limit.allow(busy)).toBe(false);
    expect(limit.allow(quiet)).toBe(true);
    expect(limit.countFor(busy)).toBe(2);
    expect(limit.countFor(quiet)).toBe(1);
  });

  test('rateLimitedCount is process-lifetime cumulative', () => {
    const limit = new WSRateLimit({ cap: 1 });
    const ip = '203.0.113.21';
    limit.allow(ip);
    limit.allow(ip); // 1 reject
    limit.allow(ip); // 2 rejects
    limit.release(ip);
    limit.allow(ip);
    limit.allow(ip); // 3 rejects
    expect(limit.rateLimitedCount).toBe(3);
  });

  test('env override is honoured', () => {
    const original = process.env.WS_MAX_CONNECTIONS_PER_IP;
    try {
      process.env.WS_MAX_CONNECTIONS_PER_IP = '12';
      const limit = new WSRateLimit();
      expect(limit.cap).toBe(12);
    } finally {
      if (original === undefined) {
        delete process.env.WS_MAX_CONNECTIONS_PER_IP;
      } else {
        process.env.WS_MAX_CONNECTIONS_PER_IP = original;
      }
    }
  });

  test('bad env override falls back to the default — never silently uncaps', () => {
    const original = process.env.WS_MAX_CONNECTIONS_PER_IP;
    try {
      for (const bad of ['', 'abc', '-1', '0', 'NaN']) {
        process.env.WS_MAX_CONNECTIONS_PER_IP = bad;
        const limit = new WSRateLimit();
        expect(limit.cap).toBe(WS_MAX_CONNECTIONS_PER_IP_DEFAULT);
      }
    } finally {
      if (original === undefined) {
        delete process.env.WS_MAX_CONNECTIONS_PER_IP;
      } else {
        process.env.WS_MAX_CONNECTIONS_PER_IP = original;
      }
    }
  });
});
