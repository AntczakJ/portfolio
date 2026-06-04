/**
 * Catch-all reverse-proxy header transforms (P0-1 fix).
 *
 * The Elysia control plane proxies every HTTP request not handled by its
 * own routes to the co-located Next.js standalone server. In production
 * the two processes collapse behind a single Fly port (Fly routes 443 to
 * one internal port), so this proxy serves the ENTIRE frontend — a
 * header bug here takes the whole UI down on first deploy.
 *
 * Two transforms live here, both pure and unit-testable in isolation
 * from the Elysia runtime:
 *
 *  1. `stripHopByHopRequestHeaders` — drops `host` and `connection` from
 *     the forwarded REQUEST headers. `host` would otherwise carry the
 *     external edge host into the upstream (the Next standalone server
 *     keys some behaviour off Host); `connection` is a per-hop control
 *     header that must not cross a proxy boundary.
 *
 *  2. `stripTransportEncodingResponseHeaders` — drops `content-encoding`,
 *     `content-length`, and `transfer-encoding` from the upstream
 *     RESPONSE headers. Bun's `fetch` transparently decompresses a
 *     gzip/br/deflate upstream body but leaves the original encoding +
 *     length headers on the `Headers` object. Forwarding those verbatim
 *     makes the browser try to decompress an already-decompressed stream
 *     and fail with `ERR_CONTENT_DECODING_FAILED`. Stripping them lets
 *     the browser see the post-decoded body for what it is.
 *
 * Mirrors meld's catch-all proxy fix (commit 39f06d2) — the same class
 * of bug, the same remedy, applied to tape's single-port topology.
 */

/** Per-hop request headers that must not be relayed across the proxy. */
const HOP_BY_HOP_REQUEST_HEADERS = ['host', 'connection'] as const;

/**
 * Transport / encoding response headers that describe the WIRE shape of
 * the upstream body, not its decoded form. The runtime has already
 * decoded the body, so these become lies the browser must not act on.
 */
const TRANSPORT_ENCODING_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
] as const;

/**
 * Return a copy of `source` with the hop-by-hop request headers removed.
 * The input is not mutated — callers build a fresh `RequestInit` from
 * the result.
 */
export function stripHopByHopRequestHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of HOP_BY_HOP_REQUEST_HEADERS) {
    headers.delete(name);
  }
  return headers;
}

/**
 * Return a copy of `source` with the transport-encoding response headers
 * removed. The input is not mutated.
 */
export function stripTransportEncodingResponseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of TRANSPORT_ENCODING_RESPONSE_HEADERS) {
    headers.delete(name);
  }
  return headers;
}
