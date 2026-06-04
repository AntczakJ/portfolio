import type { CheckErrorClass, ProbeOutcome } from '../lib/schemas/check-result';
import { SsrfBlockedError } from './ssrf-guard';

/**
 * Pure probe classification (ADR-002), extracted from the runner so the
 * up/degraded/down decision and the error-class normalisation are exhaustively
 * unit-testable WITHOUT a network or DNS. The runner does the IO (request,
 * redirects, body read) and delegates the verdict to these functions.
 *
 * Classification rules (ADR-002):
 *   - down: status not matching `expectedStatus`, or `expectedKeyword` set and
 *     absent from the (capped) body, or any transport/timeout/SSRF error.
 *   - degraded: assertions passed but `responseTimeMs > degradedThresholdMs`.
 *   - up: passed and fast.
 *
 * A `down` outcome is a VALUE, never an exception — the recorder writes it as a
 * successful job (the "down endpoint = successful job recording down" rule).
 */

export interface ClassifyInput {
  expectedStatus: number;
  expectedKeyword: string | null;
  degradedThresholdMs: number;
}

/** Classify a terminal HTTP response. `body` is the capped body (or '' if not read). */
export function classifyResponse(
  monitor: ClassifyInput,
  statusCode: number,
  body: string,
  responseTimeMs: number,
): ProbeOutcome {
  if (statusCode !== monitor.expectedStatus) {
    return { status: 'down', statusCode, responseTimeMs, error: 'http_error' };
  }

  const keyword = monitor.expectedKeyword;
  if (keyword !== null && keyword !== '') {
    if (!body.includes(keyword)) {
      return { status: 'down', statusCode, responseTimeMs, error: 'keyword_missing' };
    }
  }

  if (responseTimeMs > monitor.degradedThresholdMs) {
    return { status: 'degraded', statusCode, responseTimeMs, error: null };
  }

  return { status: 'up', statusCode, responseTimeMs, error: null };
}

/**
 * Classify a thrown error to the normalised error class (ADR-002). Order
 * matters: an SSRF block dominates, then an aborted signal is a timeout
 * regardless of the underlying code, then the per-code mapping.
 */
export function classifyError(err: unknown, aborted: boolean): CheckErrorClass {
  if (err instanceof SsrfBlockedError) return 'ssrf_blocked';
  if (aborted) return 'timeout';

  const name = err instanceof Error ? err.name : '';
  const code = errorCode(err);

  if (name === 'ProbeDnsError' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL') {
    return 'dns';
  }
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return 'connection_refused';
  }
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return 'timeout';
  }
  if (
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    (typeof code === 'string' && code.includes('TLS')) ||
    name === 'ERR_SSL'
  ) {
    return 'tls';
  }
  return 'unknown';
}

/** Extract a string `code` off an error or its `cause`. */
export function errorCode(err: unknown): string | undefined {
  if (err instanceof Error) {
    const direct = (err as { code?: unknown }).code;
    if (typeof direct === 'string') return direct;
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      const cc = (cause as { code?: unknown }).code;
      if (typeof cc === 'string') return cc;
    }
  }
  return undefined;
}
