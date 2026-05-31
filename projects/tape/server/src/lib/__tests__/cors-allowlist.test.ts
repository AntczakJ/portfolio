/**
 * CORS allowlist resolution + predicate tests — Phase 6 deploy hardening.
 *
 * The reviewer's concern was specifically the "what does CORS do
 * when ALLOWED_ORIGINS is missing in production" path. These tests
 * lock the policy:
 *
 *   - Dev defaults cover localhost on 3000-3003 with no env set.
 *   - Production with no env resolves an empty allowlist — the
 *     predicate denies every cross-origin request.
 *   - Env overrides win in both modes.
 *   - The predicate is exact case-sensitive string match — no
 *     wildcard surprises.
 *   - Requests without an Origin header (same-origin navigations)
 *     are denied at the predicate level; the @elysiajs/cors plugin
 *     does not invoke the callback for those in practice, but the
 *     predicate stays well-defined for the test surface.
 */

import { describe, expect, test } from 'bun:test';

import {
  buildOriginPredicate,
  resolveCORSAllowlist,
} from '../cors-allowlist';

describe('resolveCORSAllowlist', () => {
  test('dev default — no env, NODE_ENV not production', () => {
    const result = resolveCORSAllowlist({
      envOverride: undefined,
      modeOverride: 'development',
    });
    expect(result.source).toBe('dev-default');
    expect(result.productionMissingEnv).toBe(false);
    expect(result.origins).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ]);
  });

  test('production with no env — empty allowlist, productionMissingEnv true', () => {
    const result = resolveCORSAllowlist({
      envOverride: undefined,
      modeOverride: 'production',
    });
    expect(result.source).toBe('production-empty');
    expect(result.productionMissingEnv).toBe(true);
    expect(result.origins).toEqual([]);
  });

  test('env override wins in development', () => {
    const result = resolveCORSAllowlist({
      envOverride: 'https://demo.example.com,https://staging.example.com',
      modeOverride: 'development',
    });
    expect(result.source).toBe('env');
    expect(result.origins).toEqual([
      'https://demo.example.com',
      'https://staging.example.com',
    ]);
  });

  test('env override wins in production', () => {
    const result = resolveCORSAllowlist({
      envOverride: 'https://tape-demo.fly.dev',
      modeOverride: 'production',
    });
    expect(result.source).toBe('env');
    expect(result.productionMissingEnv).toBe(false);
    expect(result.origins).toEqual(['https://tape-demo.fly.dev']);
  });

  test('env list is trimmed and empty entries dropped', () => {
    const result = resolveCORSAllowlist({
      envOverride: '  https://a.example.com , , https://b.example.com  ,',
      modeOverride: 'production',
    });
    expect(result.origins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  test('whitespace-only env counts as unset', () => {
    const result = resolveCORSAllowlist({
      envOverride: '   ',
      modeOverride: 'production',
    });
    expect(result.source).toBe('production-empty');
    expect(result.origins).toEqual([]);
  });
});

describe('buildOriginPredicate', () => {
  function makeRequest(origin: string | null): Request {
    const headers = new Headers();
    if (origin !== null) headers.set('origin', origin);
    return new Request('http://localhost/test', { headers });
  }

  test('allows an origin on the list', () => {
    const predicate = buildOriginPredicate(['https://tape-demo.fly.dev']);
    expect(predicate(makeRequest('https://tape-demo.fly.dev'))).toBe(true);
  });

  test('denies an origin not on the list', () => {
    const predicate = buildOriginPredicate(['https://tape-demo.fly.dev']);
    expect(predicate(makeRequest('https://evil.example.com'))).toBe(false);
  });

  test('match is exact case-sensitive — scheme matters', () => {
    const predicate = buildOriginPredicate(['https://tape-demo.fly.dev']);
    expect(predicate(makeRequest('http://tape-demo.fly.dev'))).toBe(false);
  });

  test('match is exact — trailing slash matters', () => {
    const predicate = buildOriginPredicate(['https://tape-demo.fly.dev']);
    expect(predicate(makeRequest('https://tape-demo.fly.dev/'))).toBe(false);
  });

  test('match is exact — port matters', () => {
    const predicate = buildOriginPredicate(['http://localhost:3000']);
    expect(predicate(makeRequest('http://localhost:3001'))).toBe(false);
  });

  test('empty allowlist denies everything', () => {
    const predicate = buildOriginPredicate([]);
    expect(predicate(makeRequest('https://anything.example.com'))).toBe(false);
  });

  test('null origin header — denies', () => {
    const predicate = buildOriginPredicate(['https://tape-demo.fly.dev']);
    expect(predicate(makeRequest(null))).toBe(false);
  });
});
