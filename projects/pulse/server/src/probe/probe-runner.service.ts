import { performance } from 'node:perf_hooks';
import type { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { request as undiciRequest } from 'undici';

import type { Monitor } from '../db/schema';
import type { ProbeOutcome } from '../lib/schemas/check-result';
import { classifyError, classifyResponse } from './probe-classify';
import { assertProbeUrlAllowed } from './ssrf-guard';
import { buildPinnedAgent, resolveAndAssertAllowed } from './ssrf-outbound';

/**
 * The probe runner (Task 2.1, ADR-002) — the api-heavy spine.
 *
 * Executes ONE HTTP(S) check for a monitor and returns a classified
 * {@link ProbeOutcome}. The hard rules, all load-bearing:
 *
 *  - **SSRF guard at EXECUTION time.** Create-time validation (Task 1.5) is
 *    UX; this is the authoritative check, because DNS can rebind between
 *    create and probe. Every hop resolves DNS, validates EVERY resolved A/AAAA
 *    record against the denylist (`assertResolvedIpsAllowed`), and then
 *    CONNECTS TO THE VALIDATED IP — the connection is pinned to the IP the
 *    guard approved via an undici `Agent` with a custom `connect.lookup`, so a
 *    rebind between resolve and connect cannot slip through (the Host header /
 *    TLS SNI still carry the real hostname, so virtual hosts + certificates
 *    keep working).
 *  - **Manual redirects.** `maxRedirections: 0`; we follow up to
 *    {@link MAX_REDIRECTS} hops ourselves, re-running the full SSRF guard on
 *    every hop's target. Never `redirect: 'follow'` — that would bypass the
 *    per-hop check and let hop 2 land on a private IP.
 *  - **Per-attempt timeout** via `AbortController` set to `monitor.timeoutMs`.
 *  - **Body cap** of {@link BODY_CAP_BYTES} (512 KB): only the first 512 KB is
 *    read and searched for `expectedKeyword`, so a giant body cannot exhaust
 *    memory.
 *  - **No credentials / cookies forwarded; a fixed probe User-Agent.**
 *
 * A failing target (timeout, transport error, wrong status, missing keyword,
 * or an SSRF block on a redirect hop) is NOT an exception out of this method:
 * it returns a `down` outcome with the normalised error class. The caller
 * (the check recorder) records it as a SUCCESSFUL job. Only an INFRASTRUCTURE
 * fault (which this method does not throw for — it always resolves to an
 * outcome) would be a BullMQ retry, and that is the recorder's concern, not
 * the prober's. This keeps the "down endpoint = successful job recording
 * down" invariant (ADR-002) intact.
 */

/** Max redirect hops followed manually (ADR-002). */
const MAX_REDIRECTS = 5;

/** Response body read cap (ADR-002): 512 KB. */
const BODY_CAP_BYTES = 512 * 1024;

/** Fixed probe User-Agent (ADR-002). No real-browser spoofing. */
const PROBE_USER_AGENT = 'Pulse-Probe/1.0 (+https://pulse.demo)';

/** Hard cap on a per-attempt timeout regardless of the monitor's setting. */
const MAX_TIMEOUT_MS = 30_000;

/** Statuses that constitute a redirect we follow manually. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

@Injectable()
export class ProbeRunnerService {

  /**
   * Run a single check for `monitor`. Always resolves to a {@link ProbeOutcome}
   * — never throws for a target-side failure (that is a `down` outcome). The
   * only thing that escapes is a genuinely unexpected programming error, which
   * the caller treats as `unknown` and still records (the prober must not be a
   * source of un-recorded checks).
   */
  async run(monitor: Pick<Monitor,
    'targetUrl' | 'method' | 'timeoutMs' | 'expectedStatus' | 'expectedKeyword' | 'degradedThresholdMs'
  >): Promise<ProbeOutcome> {
    const start = performance.now();
    const timeoutMs = Math.min(Math.max(monitor.timeoutMs, 1), MAX_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const result = await this.execute(monitor, controller.signal, start);
      return result;
    } catch (err) {
      const responseTimeMs = Math.round(performance.now() - start);
      const errorClass = classifyError(err, controller.signal.aborted);
      return { status: 'down', statusCode: null, responseTimeMs, error: errorClass };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The redirect-following request loop. Re-runs the SSRF guard on every hop,
   * pins the connection to a validated IP, and classifies the final response.
   */
  private async execute(
    monitor: Pick<Monitor,
      'targetUrl' | 'method' | 'timeoutMs' | 'expectedStatus' | 'expectedKeyword' | 'degradedThresholdMs'
    >,
    signal: AbortSignal,
    start: number,
  ): Promise<ProbeOutcome> {
    let currentUrl = monitor.targetUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      // 1. Shape gate (scheme / credentials / literal-IP) on THIS hop's URL.
      const { url, host } = assertProbeUrlAllowed(currentUrl);

      // 2. Resolve + validate + pin. Returns the IP we will connect to.
      const pinnedIp = await resolveAndAssertAllowed(host);

      // 3. Issue the request pinned to the validated IP (Host/SNI preserved).
      const agent = buildPinnedAgent(pinnedIp);
      try {
        const res = await undiciRequest(url, {
          method: monitor.method,
          dispatcher: agent,
          maxRedirections: 0, // manual — we re-guard every hop ourselves.
          signal,
          headers: {
            'user-agent': PROBE_USER_AGENT,
            accept: '*/*',
          },
          // We never forward cookies/credentials; undici sends none by default.
        });

        const statusCode = res.statusCode;

        // Redirect? Resolve the Location against the current URL and loop.
        if (REDIRECT_STATUSES.has(statusCode)) {
          const location = this.headerValue(res.headers.location);
          // Drain the redirect body so the socket is freed.
          await this.drain(res.body);
          if (location === null) {
            // A redirect status with no Location is a broken response — treat
            // as an HTTP error against the expectation.
            return this.finishHttpStatusOnly(monitor, statusCode, start);
          }
          if (hop === MAX_REDIRECTS) {
            // Too many hops — treat as down (a redirect loop / chain).
            return { status: 'down', statusCode, responseTimeMs: Math.round(performance.now() - start), error: 'http_error' };
          }
          currentUrl = new URL(location, url).toString();
          continue;
        }

        // Terminal response — read the (capped) body if we need the keyword.
        const needsBody = monitor.expectedKeyword !== null && monitor.expectedKeyword !== '';
        const body = needsBody ? await this.readCapped(res.body) : await this.drainToEmpty(res.body);
        const responseTimeMs = Math.round(performance.now() - start);

        return classifyResponse(monitor, statusCode, body, responseTimeMs);
      } finally {
        // Always close the per-request agent so its sockets do not leak.
        await agent.close().catch(() => undefined);
      }
    }

    // Unreachable (the loop returns or continues), but TypeScript needs a path.
    return { status: 'down', statusCode: null, responseTimeMs: Math.round(performance.now() - start), error: 'http_error' };
  }

  /** Classify a status-only response (no body needed), used on a broken redirect. */
  private finishHttpStatusOnly(
    monitor: Pick<Monitor, 'expectedStatus' | 'expectedKeyword' | 'degradedThresholdMs'>,
    statusCode: number,
    start: number,
  ): ProbeOutcome {
    const responseTimeMs = Math.round(performance.now() - start);
    // No body was read; pass '' so the keyword check is skipped only when no
    // keyword is configured (a keyword-required monitor with no body is down).
    return classifyResponse(monitor, statusCode, '', responseTimeMs);
  }

  /** First value of a possibly-array header. */
  private headerValue(value: string | string[] | undefined): string | null {
    if (value === undefined) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
  }

  /**
   * Read up to {@link BODY_CAP_BYTES} bytes of the response body as UTF-8,
   * aborting (destroying the stream) once the cap is reached so a giant body
   * cannot exhaust memory. Only the first 512 KB is searched for the keyword.
   */
  private async readCapped(body: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      const buf: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as unknown as Uint8Array);
      const remaining = BODY_CAP_BYTES - total;
      if (buf.length >= remaining) {
        chunks.push(buf.subarray(0, remaining));
        total = BODY_CAP_BYTES;
        // Stop reading; destroy the underlying stream to free the socket.
        body.destroy();
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  /** Drain a body we do not need to read, returning ''. */
  private async drainToEmpty(body: Readable): Promise<string> {
    await this.drain(body);
    return '';
  }

  /** Consume and discard a stream so the connection is freed. */
  private async drain(body: Readable): Promise<void> {
    try {
      for await (const _chunk of body) {
        // discard
        void _chunk;
      }
    } catch {
      // A drain error is irrelevant — we are discarding.
    }
  }
}
