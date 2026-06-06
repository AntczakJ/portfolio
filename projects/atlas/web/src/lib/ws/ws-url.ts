/**
 * Resolve the telemetry WebSocket URL (Task 4.2).
 *
 * Priority:
 *   1. `NEXT_PUBLIC_WS_URL` if set (an explicit override — e.g. a separate WS
 *      origin in a split deploy). Documented in `.env.example`.
 *   2. Same-origin derived from `window.location`: `wss://` on HTTPS, `ws://`
 *      on HTTP, at the page host, path `/ws` (the gateway endpoint, ADR-003 /
 *      Phase 4.1 close-out). This is the production posture — the WS is proxied
 *      same-origin, which the strict CSP `connect-src 'self'` covers.
 *
 * DEV NOTE: in local dev the Next web runs on :3093 and the Fastify gateway on
 * :3092, so the same-origin derivation would point at :3093 (no WS there). For
 * local dev, set `NEXT_PUBLIC_WS_URL=ws://localhost:3092/ws` in `.env.local`.
 * The CSP `connect-src` is extended to allow `ws://localhost:3092` in dev (see
 * next.config.ts). In a deployed same-origin setup no override is needed.
 */

const WS_PATH = '/ws';

export function resolveWsUrl(): string {
  const override = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (override) return override;

  if (typeof window === 'undefined') {
    // SSR has no live socket; the client mounts the WS after hydration. This
    // branch is only hit if called server-side by mistake — return a benign
    // same-host default that the client will re-resolve.
    return WS_PATH;
  }

  const { protocol, host } = window.location;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}${WS_PATH}`;
}
