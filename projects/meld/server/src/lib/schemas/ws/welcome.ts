import { z } from 'zod';

/**
 * `welcome` control frame schema (ADR-004 — Task 1.X-control).
 *
 * Server emits exactly once per WebSocket connection, immediately after
 * the framework's `connected` hook fires (which itself fires after
 * `onConnect` + `onAuthenticate` complete and the Connection object is
 * registered in `Hocuspocus.documentConnections`). The wire form is a
 * TEXT frame — `connection.webSocket.send(JSON.stringify(payload))`
 * sends a TEXT frame via the underlying `ws` library, distinct from the
 * BINARY frames that carry the y-websocket sync + awareness opcodes per
 * AGENT_NOTES "WS control frames are TEXT frames, NOT Yjs binary
 * opcodes".
 *
 * Canonical fields (ADR-004 verbatim):
 *
 *   - `kind`             — discriminator literal `'welcome'`.
 *   - `session.id`       — UUID v4 from the anonymous-session cookie
 *                          (Task 1.7a) or a fresh server-minted UUID
 *                          when the cookie is absent (Task 1.7b
 *                          minting path — until 1.7b lands the welcome
 *                          builder uses a deterministic stub per the
 *                          `Task 1.7b populates this` fallback).
 *   - `session.emojiChar` — Unicode codepoint string from the curated
 *                           128-entry whitelist (ADR-005). The frontend
 *                           renders this directly without bundling the
 *                           whitelist itself.
 *   - `session.emojiName` — lowercase kebab-case ASCII aria-label
 *                           ('otter', 'panda'). Frontend binds this to
 *                           the visible label + screen-reader
 *                           announcement.
 *   - `session.color`    — OKLCH triple for the LIGHT theme variant.
 *                          `{ L, C, H }` matches the `oklch(L C H)` CSS
 *                          function argument order.
 *   - `session.colorDark` — OKLCH triple for the DARK theme variant.
 *                           Shipped explicitly so the client can switch
 *                           themes without re-hashing — server is the
 *                           canonical resolver per ADR-005's
 *                           "duplicated server-side AND client-side"
 *                           pin.
 *   - `board.id`         — UUID v4 echo of the `:boardId` URL segment.
 *   - `board.createdAt`  — board creation timestamp (ms epoch). Client
 *                          uses for "this board was created N minutes
 *                          ago" copy in the brand chrome.
 *   - `board.connectionCount` — post-connect connection count, this
 *                               client included.
 *   - `origin`           — the `MELD_ALLOWED_ORIGINS`-validated origin
 *                          string the server accepted on the upgrade.
 *                          Echoed for defence-in-depth client cross-
 *                          check against `window.location.origin`.
 *   - `serverTime`       — ms epoch. Client computes clock skew and
 *                          optionally surfaces a warning if it exceeds
 *                          a sane threshold (a misconfigured demo on a
 *                          machine with a wrong clock would surface
 *                          here before users notice subtle bugs).
 *   - `protocolVersion`  — literal `1` — forward-compat marker. v2
 *                          servers emit `2`, v1 clients log a fatal
 *                          warning and close without auto-reconnect.
 */

/**
 * One OKLCH color triple. `L`/`C`/`H` mirror the `oklch(L C H)` CSS
 * function-call argument order. Matches `OklchTriple` in
 * `meld-server/src/lib/session/color.ts`; the schema here is the wire
 * form of the same shape (Zod adds the inbound validation and the
 * client-side parse path inherits the structure via the types-only
 * re-export).
 */
export const wsOklchColorSchema = z.object({
  L: z.number(),
  C: z.number(),
  H: z.number(),
});

export type WSOklchColor = z.infer<typeof wsOklchColorSchema>;

/**
 * The session-identity sub-shape of the welcome frame. ADR-004 names
 * it `session`; the schema-level name `wsSessionIdentitySchema` is the
 * Zod-side label.
 *
 * Task 1.7b extension: the `mintedAt` discriminator is shipped on the
 * wire so the client can decide whether to POST `/api/session` to
 * persist the cookie out-of-band:
 *
 *   - `'cookie'`        — the WS upgrade carried a valid `meld_session`
 *                         cookie. Client does NOTHING extra; the cookie
 *                         is already sticking.
 *   - `'ws-onConnect'`  — the WS upgrade did NOT carry a cookie. The
 *                         server minted a fresh UUID v4 inside
 *                         `onConnect` and shipped it on the welcome
 *                         frame. Client POSTs `/api/session` so the
 *                         server middleware writes the cookie via the
 *                         standard `Set-Cookie` path — on the NEXT
 *                         reconnect the cookie will be present and
 *                         `mintedAt` will flip to `'cookie'`.
 *
 * The discriminator is the load-bearing fallback signal for the
 * cookie-disabled visitor path (private window, Playwright incognito,
 * deployment regression where HTTP middleware is not firing).
 */
export const wsSessionIdentitySchema = z.object({
  id: z.string().uuid(),
  emojiChar: z.string().min(1),
  emojiName: z.string().min(1),
  color: wsOklchColorSchema,
  colorDark: wsOklchColorSchema,
  mintedAt: z.enum(['cookie', 'ws-onConnect']),
});

export type WSSessionIdentity = z.infer<typeof wsSessionIdentitySchema>;

/**
 * The board-metadata sub-shape. `connectionCount` is the post-connect
 * count (this client included); `createdAt` is a ms-epoch integer for
 * cheap client-side arithmetic (ISO 8601 would force a Date parse per
 * frame for the same information).
 */
export const wsBoardMetadataSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.number().int(),
  connectionCount: z.number().int().nonnegative(),
});

export type WSBoardMetadata = z.infer<typeof wsBoardMetadataSchema>;

/**
 * The welcome frame. Top-level shape; the discriminated union in
 * `frame.ts` joins this with the other per-kind schemas.
 */
export const wsWelcomeFrameSchema = z.object({
  kind: z.literal('welcome'),
  session: wsSessionIdentitySchema,
  board: wsBoardMetadataSchema,
  origin: z.string(),
  serverTime: z.number().int(),
  protocolVersion: z.literal(1),
});

export type WSWelcomeFramePayload = z.infer<typeof wsWelcomeFrameSchema>;
