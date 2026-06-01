/**
 * Session-cookie middleware counters (ADR-005 / Task 1.7a + 1.7b).
 *
 * Four process-lifetime monotonic counters exposed on `/health` under
 * the `session` sub-shape:
 *
 *   - `sessionsMintedThisProcess` — Hono cookie middleware minted a
 *     fresh UUID v4 because the inbound request carried no valid
 *     `meld_session` cookie. Drives the dev-affordance "is my cookie
 *     sticking?" sanity check and the production "are we leaking
 *     cookies on the wire?" alarm signal.
 *   - `sessionsLoadedFromCookie` — Hono cookie middleware parsed a
 *     valid UUID v4 out of the inbound cookie and reused it. Sum across
 *     this and `sessionsMintedThisProcess` approximates the request
 *     volume through the cookie middleware (which is `app.use('*', ...)`,
 *     so every Hono request).
 *
 * Task 1.7b adds two WS-side counters covering the cookie-disabled
 * fallback path inside the Hocuspocus `onConnect` hook:
 *
 *   - `wsSessionsLoadedFromCookie` — `onConnect` parsed a valid UUID v4
 *     out of the WS upgrade request's `Cookie:` header. A return-visitor
 *     hitting the WS with cookies enabled increments this.
 *   - `wsSessionsMintedOnWsConnect` — `onConnect` minted a fresh UUID v4
 *     because the cookie was absent or malformed on the WS upgrade
 *     (cookie-disabled visitor, private window, or HTTP middleware never
 *     ran because the client linked directly to the WS path). A non-zero
 *     value in production may indicate the upstream HTTP middleware is
 *     not firing as expected (deployment regression) OR the demo URL is
 *     attracting cookie-disabled traffic — both worth monitoring.
 *
 * Task 1.7b ALSO adds one welcome-frame degraded-identity counter
 * because the welcome builder must defend against the case where the
 * extension order is wrong (cookie-read extension's `onConnect` never
 * populated `connection.context.session`):
 *
 *   - `welcomeFramesFallback` — `welcome.ts` saw `context.session`
 *     undefined at emit time and shipped a "FALLBACK" sentinel identity
 *     so the wire shape still parses. A non-zero v1 value indicates a
 *     code regression and should fail the deploy-verification sweep.
 *     Lives on `sessionMetrics` (not on `wsMetrics`) because the shape
 *     is "session-identity continuity" not "WS observability".
 *
 * Reset on process restart — same in-memory only convention as the WS
 * counter set in `src/lib/ws/metrics.ts`. The two metric sets stay
 * separate (do NOT collapse into one module) because the lifecycle is
 * different — WS counters are driven from the Hocuspocus extension /
 * upgrade handler, session counters span both Hono middleware AND the
 * Hocuspocus `onConnect` extension, and the shape "session-identity
 * minting" is one coherent observability surface across the two
 * transports.
 */

export interface SessionMetricsSnapshot {
  sessionsMintedThisProcess: number;
  sessionsLoadedFromCookie: number;
  wsSessionsLoadedFromCookie: number;
  wsSessionsMintedOnWsConnect: number;
  welcomeFramesFallback: number;
}

interface SessionMetricsState {
  sessionsMintedThisProcess: number;
  sessionsLoadedFromCookie: number;
  wsSessionsLoadedFromCookie: number;
  wsSessionsMintedOnWsConnect: number;
  welcomeFramesFallback: number;
}

const state: SessionMetricsState = {
  sessionsMintedThisProcess: 0,
  sessionsLoadedFromCookie: 0,
  wsSessionsLoadedFromCookie: 0,
  wsSessionsMintedOnWsConnect: 0,
  welcomeFramesFallback: 0,
};

export const sessionMetrics = {
  /**
   * Increment after the Hono middleware mints a fresh UUID v4 and writes
   * the cookie. Called once per cookie-less first-touch request.
   */
  recordMint(): void {
    state.sessionsMintedThisProcess += 1;
  },

  /**
   * Increment after the Hono middleware parses a valid UUID v4 out of
   * an existing `meld_session` cookie. Called once per returning-visitor
   * HTTP request.
   */
  recordLoad(): void {
    state.sessionsLoadedFromCookie += 1;
  },

  /**
   * Task 1.7b — increment when the Hocuspocus `onConnect` extension
   * parses a valid UUID v4 out of the WS upgrade request's `Cookie:`
   * header. Called once per cookie-carrying WS upgrade.
   */
  recordWsLoad(): void {
    state.wsSessionsLoadedFromCookie += 1;
  },

  /**
   * Task 1.7b — increment when the Hocuspocus `onConnect` extension
   * mints a fresh UUID v4 because the WS upgrade did not carry a
   * valid `meld_session` cookie. Called once per cookie-less WS upgrade.
   */
  recordWsMint(): void {
    state.wsSessionsMintedOnWsConnect += 1;
  },

  /**
   * Task 1.7b — increment when the welcome-frame builder hits the
   * degraded-identity fallback path because `context.session` was
   * missing at emit time. v1 ceiling is zero; a non-zero value means the
   * cookie-read extension did not populate the context (extension order
   * regression OR cookie-read extension threw before populating).
   */
  recordWelcomeFallback(): void {
    state.welcomeFramesFallback += 1;
  },

  /** Return a fresh snapshot — safe to mutate without affecting state. */
  snapshot(): SessionMetricsSnapshot {
    return {
      sessionsMintedThisProcess: state.sessionsMintedThisProcess,
      sessionsLoadedFromCookie: state.sessionsLoadedFromCookie,
      wsSessionsLoadedFromCookie: state.wsSessionsLoadedFromCookie,
      wsSessionsMintedOnWsConnect: state.wsSessionsMintedOnWsConnect,
      welcomeFramesFallback: state.welcomeFramesFallback,
    };
  },

  /**
   * Reset all counters. Test-only — production code must not call this
   * (a Prometheus scrape would see a fictional dip if counters reset
   * mid-life). Kept here rather than in a separate test helper to
   * mirror `wsMetrics`.
   */
  reset(): void {
    state.sessionsMintedThisProcess = 0;
    state.sessionsLoadedFromCookie = 0;
    state.wsSessionsLoadedFromCookie = 0;
    state.wsSessionsMintedOnWsConnect = 0;
    state.welcomeFramesFallback = 0;
  },
};
