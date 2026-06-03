import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

/**
 * Security-header contract for razors-edge (ADR-002 CSP posture).
 *
 * Asserts the catch-all `headers()` ships the canonical baseline AND
 * the CSP posture this project commits to:
 *   - `script-src 'self' 'unsafe-inline'` with NO `'unsafe-eval'`.
 *     The load-bearing guarantee is the absence of `'unsafe-eval'`
 *     (proves GSAP needs no eval). `'unsafe-inline'` for scripts is
 *     required because Next 15 emits unhashed inline bootstrap scripts
 *     that a bare `script-src 'self'` blocks, killing hydration — the
 *     v1.1 hardening is per-request nonce middleware (documented debt).
 *   - `style-src 'self' 'unsafe-inline'` — required for Tailwind +
 *     GSAP inline transforms (documented v1.1 style-nonce debt).
 *   - `connect-src 'self'` only — there is no network in v1 (the
 *     booking flow is mocked in-memory; ADR-003). No `wss:`/`ws:`.
 */
describe('next.config.ts security headers', () => {
  it('declares a headers() async function', () => {
    expect(typeof nextConfig.headers).toBe('function');
  });

  it('returns a single catch-all source pattern targeting every route', async () => {
    const fn = nextConfig.headers;
    if (!fn) throw new Error('headers() missing');
    const rules = await fn();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBe(1);
    expect(rules[0]?.source).toBe('/(.*)');
  });

  it('emits all five canonical security headers on every route', async () => {
    const fn = nextConfig.headers;
    if (!fn) throw new Error('headers() missing');
    const rules = await fn();
    const headers = rules[0]?.headers ?? [];
    const byKey = Object.fromEntries(
      headers.map((h: { key: string; value: string }) => [h.key, h.value]),
    );
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(byKey['Content-Security-Policy']).toBeDefined();
  });

  it('ships the CSP posture: no unsafe-eval (GSAP guarantee), no network, injection defences', async () => {
    const fn = nextConfig.headers;
    if (!fn) throw new Error('headers() missing');
    const rules = await fn();
    const headers = rules[0]?.headers ?? [];
    const csp =
      headers.find(
        (h: { key: string }) => h.key === 'Content-Security-Policy',
      )?.value ?? '';

    // Self-default — no third-party surface.
    expect(csp).toContain("default-src 'self'");
    // Scripts: self + inline (Next bootstrap), but NEVER eval. The
    // unsafe-eval ban is the load-bearing GSAP guarantee.
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    // Styles: unsafe-inline IS required (Tailwind + GSAP transforms).
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    // No network in v1 — mocked booking flow, no wss/ws.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('wss:');
    // Clickjacking + injection defences.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
