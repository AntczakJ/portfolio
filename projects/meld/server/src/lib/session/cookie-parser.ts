/**
 * Raw `Cookie:` header parser (Task 1.7b — ADR-005).
 *
 * Lifted out of `cookie.ts` so the same parsing logic is shared between
 * the Hono HTTP middleware (which uses `hono/cookie`'s `getCookie(c, name)`
 * helper under the hood) and the Hocuspocus `onConnect` extension hook
 * (which sees the WS upgrade request's raw `Cookie:` header string and
 * needs a header-level parser, not a Hono-context one).
 *
 * Why a fresh implementation rather than reusing `hono/cookie`:
 *
 *   - `hono/cookie` exposes `getCookie(c: Context, name)` — it requires a
 *     Hono `Context` instance, which the Hocuspocus `onConnect` payload
 *     does NOT carry. The upstream Yjs / Hocuspocus framework reads the
 *     WS upgrade request straight from Node's `http.IncomingMessage`
 *     (bridged through `ws.WebSocketServer({ noServer: true })` per
 *     ADR-002) and exposes it as a Fetch-style `Request` with a `Headers`
 *     instance. Wrapping the upgrade in a synthetic Hono context to reuse
 *     `getCookie` is more indirection than parsing the header directly.
 *
 *   - Node 22 ships `cookie` parsing only inside `undici` (the fetch
 *     implementation), with no public export. Importing a third-party
 *     dependency for ~15 lines of header parsing is over-engineering.
 *
 * Per the RFC 6265 § 5.4 cookie-string grammar:
 *
 *   cookie-string = cookie-pair *( ";" SP cookie-pair )
 *   cookie-pair   = cookie-name "=" cookie-value
 *
 * The parser tolerates the common informal looseness browsers send:
 * trailing semicolons, missing spaces after the semicolon, empty pairs,
 * and `=`-less segments. Values are passed through verbatim — UUID v4
 * validation lives in the caller because the regex is a meld-specific
 * shape, not a general cookie concern.
 *
 * Iteration is by a single `split(';')` followed by per-pair `indexOf('=')`
 * to handle values that themselves contain `=` (the cookie value is
 * everything after the FIRST `=`). RFC 6265 strictly forbids `=` in
 * cookie names but allows it in values — the split-on-first-`=` rule
 * matches what `hono/cookie`, Express's `cookie-parser`, and the
 * undici-internal parser all do.
 */

/**
 * Parse a raw `Cookie:` header string into a flat record. Last value wins
 * for duplicate names (matches RFC 6265 § 5.3 step 11 — "process cookies
 * in the order they appear in the header").
 *
 *   parseCookieHeader('a=1; b=2; a=3') === { a: '3', b: '2' }
 *   parseCookieHeader('') === {}
 *   parseCookieHeader(undefined) === {}
 *
 * Values are NOT URL-decoded — meld's `meld_session` cookie is a UUID v4
 * which contains only `[0-9a-f-]` characters and never needs decoding.
 * If a future cookie ships URL-encoded content, the consumer should call
 * `decodeURIComponent` at the use site (where it knows the encoding
 * convention) rather than this parser making an assumption.
 */
export function parseCookieHeader(
  header: string | undefined | null,
): Record<string, string> {
  if (header === undefined || header === null || header === '') {
    return {};
  }

  const out: Record<string, string> = {};
  for (const rawPair of header.split(';')) {
    const pair = rawPair.trim();
    if (pair === '') continue;
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
      // RFC 6265 § 5.2 step 4: pairs without `=` are ignored.
      continue;
    }
    const name = pair.slice(0, eqIdx).trim();
    if (name === '') continue;
    const value = pair.slice(eqIdx + 1).trim();
    out[name] = value;
  }
  return out;
}

/**
 * Read a single cookie value by name from a raw `Cookie:` header. Returns
 * `undefined` when the header is empty or the name is absent. Calling
 * sites should validate the shape of the returned string (e.g., UUID v4
 * regex) before trusting it.
 *
 * Implemented as `parseCookieHeader(header)[name]` rather than a streaming
 * scan because: (a) a real WS upgrade Cookie header carries ~1-3 cookies
 * in the v1 setup; (b) the allocation cost is dominated by the
 * `split(';')` either way; (c) the call-once nature inside `onConnect`
 * makes the optimisation invisible. If a future caller needs to scan a
 * large multi-cookie header on a hot path, the streaming form is a
 * straightforward optimisation that does not change the contract.
 */
export function readCookieFromHeader(
  header: string | undefined | null,
  name: string,
): string | undefined {
  const parsed = parseCookieHeader(header);
  return parsed[name];
}

/**
 * UUID v4 (8-4-4-4-12 hex, version nibble = 4, variant nibble in
 * `[8,9,a,b]`). Mirrors the regex in `cookie.ts` verbatim per ADR-005's
 * "strict-lowercase form `node:crypto.randomUUID()` emits" pin.
 *
 * Exported so the Hocuspocus `onConnect` extension hook in
 * `src/lib/ws/on-connect.ts` can validate parsed cookie values without
 * duplicating the regex.
 */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Type guard: is the value a strict-lowercase UUID v4?
 */
export function isUuidV4(value: string | undefined): value is string {
  return value !== undefined && UUID_V4_REGEX.test(value);
}
