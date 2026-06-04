import { describe, expect, it } from 'vitest';

import { classifyError, classifyResponse, errorCode } from './probe-classify';
import { SsrfBlockedError } from './ssrf-guard';

/**
 * Probe classification tests (ADR-002, Task 2.1 / Task 8.1).
 *
 * Covers the up/degraded/down decision (status / keyword / response-time
 * threshold) and the normalised error-class mapping — the verdict logic the
 * runner delegates to, exhaustively testable without a network. The crucial
 * rule under test: a failing target produces a `down` VALUE (never throws), so
 * the recorder writes it as a successful job.
 */

const baseMonitor = {
  expectedStatus: 200,
  expectedKeyword: null as string | null,
  degradedThresholdMs: 1000,
};

describe('classifyResponse — status / keyword / threshold', () => {
  it('up: expected status, fast, no keyword required', () => {
    const out = classifyResponse(baseMonitor, 200, '', 120);
    expect(out).toEqual({ status: 'up', statusCode: 200, responseTimeMs: 120, error: null });
  });

  it('degraded: expected status but slower than the threshold', () => {
    const out = classifyResponse(baseMonitor, 200, '', 1500);
    expect(out.status).toBe('degraded');
    expect(out.error).toBeNull();
    expect(out.statusCode).toBe(200);
  });

  it('threshold boundary: equal to the threshold is up (strictly greater is degraded)', () => {
    expect(classifyResponse(baseMonitor, 200, '', 1000).status).toBe('up');
    expect(classifyResponse(baseMonitor, 200, '', 1001).status).toBe('degraded');
  });

  it('down: wrong status code is http_error (the down-records-result rule)', () => {
    const out = classifyResponse(baseMonitor, 500, '', 50);
    expect(out).toEqual({ status: 'down', statusCode: 500, responseTimeMs: 50, error: 'http_error' });
  });

  it('down: a 500 is recorded as a down RESULT, not thrown — classifyResponse returns a value', () => {
    // The function never throws; the caller records this down outcome as a
    // successful job (ADR-002).
    expect(() => classifyResponse(baseMonitor, 503, 'Service Unavailable', 30)).not.toThrow();
    expect(classifyResponse(baseMonitor, 503, '', 30).status).toBe('down');
  });

  it('down: keyword required and absent is keyword_missing', () => {
    const m = { ...baseMonitor, expectedKeyword: 'OK' };
    const out = classifyResponse(m, 200, 'totally different body', 100);
    expect(out).toEqual({ status: 'down', statusCode: 200, responseTimeMs: 100, error: 'keyword_missing' });
  });

  it('up: keyword required and present', () => {
    const m = { ...baseMonitor, expectedKeyword: 'healthy' };
    const out = classifyResponse(m, 200, '{"status":"healthy"}', 80);
    expect(out.status).toBe('up');
  });

  it('keyword check runs only after the status check passes', () => {
    // Wrong status short-circuits to http_error even if the keyword is present.
    const m = { ...baseMonitor, expectedKeyword: 'healthy' };
    const out = classifyResponse(m, 500, 'healthy', 80);
    expect(out.error).toBe('http_error');
  });

  it('degraded only applies when the keyword (if any) also passes', () => {
    const m = { ...baseMonitor, expectedKeyword: 'OK', degradedThresholdMs: 100 };
    // Slow but keyword present -> degraded.
    expect(classifyResponse(m, 200, 'OK', 500).status).toBe('degraded');
    // Slow AND keyword missing -> down (keyword_missing wins over degraded).
    expect(classifyResponse(m, 200, 'nope', 500).error).toBe('keyword_missing');
  });

  it('empty-string keyword is treated as "no keyword"', () => {
    const m = { ...baseMonitor, expectedKeyword: '' };
    expect(classifyResponse(m, 200, '', 100).status).toBe('up');
  });
});

describe('classifyError — normalised error class', () => {
  it('an SSRF block dominates everything (including an abort)', () => {
    expect(classifyError(new SsrfBlockedError('blocked'), true)).toBe('ssrf_blocked');
  });

  it('an aborted signal is a timeout', () => {
    expect(classifyError(new Error('aborted'), true)).toBe('timeout');
  });

  it('a wrapped DNS failure is dns', () => {
    const e = new Error('dns lookup failed');
    e.name = 'ProbeDnsError';
    expect(classifyError(e, false)).toBe('dns');
  });

  it('ENOTFOUND / EAI_AGAIN map to dns', () => {
    expect(classifyError(withCode('ENOTFOUND'), false)).toBe('dns');
    expect(classifyError(withCode('EAI_AGAIN'), false)).toBe('dns');
  });

  it('ECONNREFUSED maps to connection_refused', () => {
    expect(classifyError(withCode('ECONNREFUSED'), false)).toBe('connection_refused');
  });

  it('ECONNRESET / EHOSTUNREACH map to connection_refused', () => {
    expect(classifyError(withCode('ECONNRESET'), false)).toBe('connection_refused');
    expect(classifyError(withCode('EHOSTUNREACH'), false)).toBe('connection_refused');
  });

  it('ETIMEDOUT and undici header/body timeouts map to timeout', () => {
    expect(classifyError(withCode('ETIMEDOUT'), false)).toBe('timeout');
    expect(classifyError(withCode('UND_ERR_HEADERS_TIMEOUT'), false)).toBe('timeout');
    expect(classifyError(withCode('UND_ERR_BODY_TIMEOUT'), false)).toBe('timeout');
  });

  it('certificate errors map to tls', () => {
    expect(classifyError(withCode('CERT_HAS_EXPIRED'), false)).toBe('tls');
    expect(classifyError(withCode('DEPTH_ZERO_SELF_SIGNED_CERT'), false)).toBe('tls');
    expect(classifyError(withCode('ERR_TLS_CERT_ALTNAME_INVALID'), false)).toBe('tls');
  });

  it('an unrecognised error is unknown', () => {
    expect(classifyError(new Error('mystery'), false)).toBe('unknown');
    expect(classifyError(withCode('ESOMETHINGELSE'), false)).toBe('unknown');
  });

  it('reads the code off a wrapped cause (undici nests the socket error)', () => {
    const outer = new Error('fetch failed');
    (outer as { cause?: unknown }).cause = withCode('ECONNREFUSED');
    expect(classifyError(outer, false)).toBe('connection_refused');
    expect(errorCode(outer)).toBe('ECONNREFUSED');
  });
});

function withCode(code: string): Error {
  const e = new Error(code);
  (e as { code?: unknown }).code = code;
  return e;
}
