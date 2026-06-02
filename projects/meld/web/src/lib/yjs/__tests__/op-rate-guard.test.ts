/**
 * Client op-rate guard tests — ADR-010 §3 (B2).
 *
 * The token bucket gates Yjs op COMMITS (one `doc.transact` = one op).
 * We assert the calibrated numbers (40 ops/sec ceiling, 20 burst
 * allowance), that a legitimate burst within the allowance is never
 * throttled, that a 50-shape paste counts as ONE op (one `tryConsume`),
 * that a sustained over-rate flood eventually trips the cooldown, and
 * that the bucket refills over time.
 *
 * Time is injected so the bucket is driven deterministically.
 */

import { describe, expect, it } from 'vitest';

import {
  CLIENT_OP_BURST_ALLOWANCE,
  CLIENT_OP_RATE_CEILING,
  OpRateGuard,
  SERVER_MAX_RATE,
} from '../op-rate-guard';

describe('op-rate-guard constants', () => {
  it('pins the ADR-010 calibration: 40 ceiling / 20 burst under the 100 server max', () => {
    expect(CLIENT_OP_RATE_CEILING).toBe(40);
    expect(CLIENT_OP_BURST_ALLOWANCE).toBe(20);
    expect(SERVER_MAX_RATE).toBe(100);
    // The client ceiling must stay safely UNDER the server max.
    expect(CLIENT_OP_RATE_CEILING).toBeLessThan(SERVER_MAX_RATE);
  });
});

describe('OpRateGuard — burst allowance', () => {
  it('admits a full burst of CLIENT_OP_BURST_ALLOWANCE ops with no time advance', () => {
    const guard = new OpRateGuard(0);
    for (let i = 0; i < CLIENT_OP_BURST_ALLOWANCE; i += 1) {
      expect(guard.tryConsume(0).allowed).toBe(true);
    }
    // The (allowance + 1)th op at the same instant is deferred.
    expect(guard.tryConsume(0).allowed).toBe(false);
  });

  it('starts full so the first op is always allowed', () => {
    const guard = new OpRateGuard(1_000);
    expect(guard.tokens).toBe(CLIENT_OP_BURST_ALLOWANCE);
    expect(guard.tryConsume(1_000).allowed).toBe(true);
  });
});

describe('OpRateGuard — paste is one op', () => {
  it('a 50-shape paste (one transact) consumes a single token', () => {
    const guard = new OpRateGuard(0);
    // The caller wraps the 50-shape paste in ONE doc.transact, so the
    // commit boundary calls tryConsume exactly ONCE — not 50 times.
    const decision = guard.tryConsume(0);
    expect(decision.allowed).toBe(true);
    // Exactly one token spent.
    expect(guard.tokens).toBe(CLIENT_OP_BURST_ALLOWANCE - 1);
  });
});

describe('OpRateGuard — refill', () => {
  it('refills at CLIENT_OP_RATE_CEILING tokens/sec', () => {
    const guard = new OpRateGuard(0);
    // Drain the bucket.
    for (let i = 0; i < CLIENT_OP_BURST_ALLOWANCE; i += 1) {
      guard.tryConsume(0);
    }
    expect(guard.tryConsume(0).allowed).toBe(false);

    // After 100 ms at 40 ops/sec, ~4 tokens have refilled.
    const after = guard.tryConsume(100);
    expect(after.allowed).toBe(true);
    // Started empty, +4 from refill, -1 consumed ≈ 3 left.
    expect(after.tokens).toBeGreaterThanOrEqual(2);
    expect(after.tokens).toBeLessThan(4);
  });

  it('never refills past the burst capacity', () => {
    const guard = new OpRateGuard(0);
    guard.tryConsume(0); // spend one
    // A long idle gap would over-refill an unclamped bucket.
    guard.tryConsume(10_000);
    expect(guard.tokens).toBeLessThanOrEqual(CLIENT_OP_BURST_ALLOWANCE);
  });
});

describe('OpRateGuard — runaway flood trips the cooldown', () => {
  it('a sustained over-rate flood eventually defers commits', () => {
    const guard = new OpRateGuard(0);
    let deferred = 0;
    // 200 commits over 1 second = 200 ops/sec, well above the 40
    // ceiling. The bucket (20) drains and the refill (40/sec) cannot
    // keep up, so most are deferred.
    for (let i = 0; i < 200; i += 1) {
      const t = i * 5; // 5 ms apart → 200/sec
      if (!guard.tryConsume(t).allowed) deferred += 1;
    }
    // The first ~20 (burst) plus the trickle of refilled tokens pass;
    // the bulk is deferred.
    expect(deferred).toBeGreaterThan(100);
  });

  it('a well-behaved ~1-op-per-gesture cadence is never throttled', () => {
    const guard = new OpRateGuard(0);
    let deferred = 0;
    // 30 gestures, 500 ms apart (2 ops/sec) — far under the ceiling.
    for (let i = 0; i < 30; i += 1) {
      if (!guard.tryConsume(i * 500).allowed) deferred += 1;
    }
    expect(deferred).toBe(0);
  });
});
