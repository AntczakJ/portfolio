/**
 * Awareness identity Zod schema (Task 2.5a).
 *
 * The shape of the `identity` field meld writes to the Yjs `Awareness`
 * local state. The server's welcome frame is the SOURCE of truth for
 * a connection's identity (see ADR-005 — cookie ↔ welcome-frame
 * contract); Task 2.5a's job is to mirror that payload into the local
 * awareness state field so REMOTE peers can read OUR identity (and we
 * can read THEIRS) via the y-protocols/awareness fan-out.
 *
 *   Wire path of the field, end-to-end:
 *
 *     1. Server emits welcome TEXT frame → `useWelcomeStore.setWelcome`.
 *     2. `createBoardProvider` subscribes to the welcome store and
 *        calls `provider.awareness.setLocalStateField('identity', ...)`.
 *     3. Yjs encodes the local state and ships it to peers via the
 *        y-protocols/awareness binary frame stream.
 *     4. Each peer receives the encoded state. The peer's `Awareness`
 *        decodes it and fires a `'change'` event.
 *     5. `useAwareness()` reads `awareness.getStates()` on each change,
 *        parses each `state.identity` against THIS schema, drops
 *        malformed entries, and exposes `{ local, remote }` to React.
 *
 * REUSE OF THE SERVER SHAPE (NOT THE SERVER ZOD RUNTIME)
 *   We mirror the field shape of `wsSessionIdentitySchema` from
 *   `meld-server/src/lib/schemas/ws/welcome.ts` MINUS the `mintedAt`
 *   discriminator (that field is welcome-frame metadata for the
 *   cookie-disabled fallback flow, not part of the on-the-wire
 *   awareness identity — remote peers do not need to know HOW our
 *   session id was minted).
 *
 *   The Zod schema is written INLINE here per ADR-006's types-only
 *   cross-package contract: importing the server's Zod schemas would
 *   drag the runtime into the browser bundle. We import the SERVER
 *   TYPE `WSOklchColor` via `import type` for structural equivalence
 *   and write the Zod shape from scratch. If the server-side shape
 *   drifts (e.g., a future `oklch(L C H A)` 4-tuple) the type-only
 *   import will surface the contract drift at typecheck time when
 *   Task 2.5a's consumers feed `AwarenessIdentity` into shape-
 *   parametric helpers.
 *
 * MALFORMED-ENTRY POLICY
 *   `awarenessIdentitySchema.safeParse(...)` returns a Zod result; we
 *   drop malformed entries silently in PRODUCTION and warn loudly in
 *   DEV. Malformed = a peer connected with a protocol version that
 *   broke the wire (v2 client on a v1 server, OR a deployed-demo
 *   regression where the server's emoji whitelist edits desync the
 *   string shape). The board's chrome must stay whole — a single
 *   malformed peer is not a fatal condition.
 */

import { z } from 'zod';

import type { WSOklchColor } from 'meld-server';

const oklchColorSchema = z.object({
  L: z.number(),
  C: z.number(),
  H: z.number(),
});

/**
 * The awareness identity payload — structurally a subset of the
 * welcome frame's `session` field, MINUS the `mintedAt` discriminator
 * (that's HTTP-side metadata, not on-the-wire awareness state).
 */
export const awarenessIdentitySchema = z.object({
  sessionId: z.uuid(),
  emojiChar: z.string().min(1),
  emojiName: z.string().min(1),
  color: oklchColorSchema,
  colorDark: oklchColorSchema,
});

export type AwarenessIdentity = z.infer<typeof awarenessIdentitySchema>;

/**
 * Cursor position (Phase 3.3). Board-space coordinates, NOT screen-space —
 * the pointer overlay converts from client coords to overlay-relative
 * coords before writing the awareness field, and the cursor painter
 * consumes the same coordinate space (the engine is already pinned to
 * CSS pixels by the `ctx.scale(dpr, dpr)` applied in `handleResize`).
 *
 * `null` means the cursor has left the canvas region — the cursor
 * painter fades the remote cursor out via the engine's opacity ramp.
 * Omitted (undefined) on the wire is equivalent to `null` per the
 * useAwareness adapter contract; downstream consumers see `null` only.
 */
export const awarenessCursorSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .nullable();

export type AwarenessCursor = z.infer<typeof awarenessCursorSchema>;

/**
 * Composite peer state field set (Phase 3.3 extends Task 2.5a's identity-
 * only schema). A peer's awareness object on the wire is
 *
 *   { identity: AwarenessIdentity, cursor?: AwarenessCursor }
 *
 * with `cursor` optional for forward compatibility (a v1.0 client that
 * never moved its pointer never wrote the field; we treat absent as
 * `null`). `identity` REMAINS required — Task 2.5a's drop-on-missing
 * policy is preserved.
 */
export const awarenessStateSchema = z.object({
  identity: awarenessIdentitySchema,
  cursor: awarenessCursorSchema.optional(),
});

export type AwarenessState = z.infer<typeof awarenessStateSchema>;

/**
 * Structural equivalence assertion — `AwarenessIdentity.color` and
 * `WSOklchColor` from the server's wire schema MUST be the same shape.
 * The assertion is types-only (the `satisfies` is erased) and runs at
 * typecheck time. If the server adds a fourth OKLCH component or
 * renames a field, the meld-web typecheck fails here at the seam, NOT
 * at a downstream consumer.
 */
const _typeSpotCheck: AwarenessIdentity['color'] = {} as WSOklchColor;
void _typeSpotCheck;

/**
 * A peer's awareness state, as exposed to React consumers via
 * `useAwareness()`. `clientId` is the Yjs `Awareness.clientID` (a
 * numeric id assigned per WebSocket connection — NOT the session id).
 * Two tabs of the same browser have the same `sessionId` (cookie-
 * persisted) but distinct `clientId`s (one per connection) — per
 * ADR-005's "two tabs = two cursors" rule.
 *
 * `cursor` is the latest board-space pointer position OR `null` when
 * the peer's pointer is off-canvas (pointerleave on the overlay region).
 * `null` is the cue for the cursor engine to fade the remote cursor
 * out via its opacity ramp. Phase 3.3 extends Task 2.5a's identity-only
 * peer shape with this field.
 */
export interface AwarenessPeer {
  clientId: number;
  identity: AwarenessIdentity;
  cursor: AwarenessCursor;
  /** ms epoch when this peer's state was last observed. */
  lastSeenMs: number;
}

/**
 * A discriminated `Result` over `safeParse` so consumers can branch
 * without reaching into Zod's tagged-union shape directly. Mirrors
 * the `Result<T, E>` convention common to ts-results / neverthrow but
 * stays dependency-free.
 */
export type AwarenessParseResult =
  | { ok: true; value: AwarenessIdentity }
  | { ok: false; error: z.ZodError };

export function parseAwarenessIdentity(input: unknown): AwarenessParseResult {
  const result = awarenessIdentitySchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error };
}

/**
 * Parse a peer's `cursor` field tolerantly. Treats missing / undefined /
 * malformed input as `null` (the off-canvas state). This is the load-
 * bearing forward-compat shim — Task 2.5a's identity-only clients never
 * wrote the field, and a v1.0 client that never moved its pointer never
 * wrote it either. Both cases collapse to "no cursor to paint", which is
 * the correct visual semantics for both.
 *
 * In contrast to `parseAwarenessIdentity`, a malformed cursor field is
 * NOT a peer-dropping condition — the peer's identity is intact, the
 * cursor is just absent. The cursor engine treats absent cursor the
 * same way as `null` and either fades out an existing one or skips
 * painting if the peer never had a cursor.
 */
export function parseAwarenessCursor(input: unknown): AwarenessCursor {
  if (input === undefined || input === null) return null;
  const result = awarenessCursorSchema.safeParse(input);
  if (!result.success) return null;
  return result.data;
}
