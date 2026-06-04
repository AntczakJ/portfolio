import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

/**
 * Security-header contract for the Pulse web app (mirrors the
 * meld / razors-edge verification discipline).
 *
 * Asserts the canonical baseline ships on every route, and — load-bearing
 * for this project — that the CSP is STRICT: `default-src 'self'` and
 * crucially NO `'unsafe-eval'` (the meld / razors-edge lesson; the live
 * SSE board + Zod-envelope validation must run clean under it). The
 * `'unsafe-inline'` for scripts is documented v1.1 nonce-hardening debt.
 */
describe('next.config.ts security headers', () => {
  it('declares a headers() function', () => {
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

  it('ships a strict CSP with the load-bearing directives and NO unsafe-eval', async () => {
    const fn = nextConfig.headers;
    if (!fn) throw new Error('headers() missing');
    const rules = await fn();
    const headers = rules[0]?.headers ?? [];
    const csp =
      headers.find(
        (h: { key: string }) => h.key === 'Content-Security-Policy',
      )?.value ?? '';

    // Self-default — no third-party leaks.
    expect(csp).toContain("default-src 'self'");
    // The load-bearing guarantee: no eval source anywhere in the policy.
    expect(csp).not.toContain('unsafe-eval');
    // Same-origin connect covers fetch + the EventSource SSE stream behind
    // the single-origin reverse proxy (ADR-006).
    expect(csp).toContain("connect-src 'self'");
    // Clickjacking defence — mirrors X-Frame-Options: DENY.
    expect(csp).toContain("frame-ancestors 'none'");
    // <base> injection defence.
    expect(csp).toContain("base-uri 'self'");
    // Form-action lock.
    expect(csp).toContain("form-action 'self'");
    // unsafe-inline (scripts/styles) is documented v1.1 nonce-hardening debt.
    expect(csp).toContain("'unsafe-inline'");
  });

  it('keeps connect-src self-only when no distinct API origin is configured (prod proxy posture)', async () => {
    // With NEXT_PUBLIC_API_URL / SSE_URL unset (the test env), the computed
    // connect-src is `'self'` only — the deployed single-origin reverse-proxy
    // posture (ADR-006): the API + SSE are same-origin behind pulse-web.
    const fn = nextConfig.headers;
    if (!fn) throw new Error('headers() missing');
    const rules = await fn();
    const headers = rules[0]?.headers ?? [];
    const csp =
      headers.find(
        (h: { key: string }) => h.key === 'Content-Security-Policy',
      )?.value ?? '';
    // The directive is exactly `connect-src 'self'` (no extra origin), and
    // it still never carries a blanket wildcard.
    expect(csp).toMatch(/connect-src 'self'(;|$)/);
    expect(csp).not.toContain('connect-src *');
  });
});
