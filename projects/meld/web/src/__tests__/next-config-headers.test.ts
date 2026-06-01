import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

/**
 * Tests for the Phase 4.2 reviewer's medium security finding —
 * security headers added to `web/next.config.ts` and bundled into
 * Phase 4.3.
 *
 * Asserts the canonical baseline ships:
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - X-Frame-Options: DENY
 *   - Strict-Transport-Security: max-age=63072000; includeSubDomains
 *   - Content-Security-Policy: a self-default CSP that allows wss:
 *     for the WS upgrade and unsafe-inline for Next 15's runtime
 *     (the unsafe-inline debt is documented in AGENT_NOTES.md for
 *     v1.1 nonce-hardening).
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

  it('ships a CSP that allows the WSS upgrade and includes the load-bearing directives', async () => {
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
    // WSS upgrade for /ws/board/:boardId.
    expect(csp).toContain('connect-src');
    expect(csp).toContain('wss:');
    // Clickjacking defence — mirrors X-Frame-Options: DENY.
    expect(csp).toContain("frame-ancestors 'none'");
    // <base> injection defence.
    expect(csp).toContain("base-uri 'self'");
    // Form-action lock.
    expect(csp).toContain("form-action 'self'");
    // unsafe-inline is documented v1.1 debt (nonce hardening).
    expect(csp).toContain("'unsafe-inline'");
  });
});
