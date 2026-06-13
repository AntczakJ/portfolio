import { z } from 'zod';

/**
 * `/api/session` response contract (ADR-005 / Task 1.7a).
 *
 * The endpoint returns the current session-context for the request:
 * UUID v4 id + resolved emoji codepoint + screen-reader-friendly name.
 * The frontend hits this on initial page mount to pre-render the
 * brand-corner identity card BEFORE the WS welcome frame arrives. The
 * cookie middleware writes `c.set('session', ...)` for every request,
 * and this endpoint just projects it onto the wire after Zod
 * validation at the boundary.
 *
 * Per-board awareness color is NOT part of this response — boards are
 * a WS concern, not an HTTP concern. The welcome frame (Task 1.7b)
 * ships the color resolved against the connected `boardId`.
 *
 * Schemas live in `src/lib/schemas/` per docs/conventions.md § 5 —
 * the contract is shared between server (validates outbound) and the
 * Hono RPC client on the web side (validates inbound). Adding a field
 * is non-breaking; removing or renaming bumps the
 * `/api/session` contract version.
 */

/**
 * Session id — UUID v4 in canonical 8-4-4-4-12 lowercase form.
 *
 * Zod's `z.uuid()` matches any UUID version; we want strict v4 because
 * that's what `node:crypto.randomUUID()` emits and what the cookie
 * middleware's `UUID_V4_REGEX` accepts on the way IN. Keeping the
 * inbound and outbound shapes symmetric prevents an "I parsed an
 * inbound v1 UUID but my outbound schema accepted it" drift.
 */
const sessionIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'session id must be a lowercase UUID v4',
  );

export const sessionResponseSchema = z.object({
  id: sessionIdSchema,
  emojiChar: z.string().min(1),
  emojiName: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]*$/,
      'emoji name must be lowercase kebab-case ASCII',
    ),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * `POST /api/session` request body (Task 1.7b — ADR-005 cookie-disabled
 * fallback).
 *
 * Optional `sessionId` field: when present and a valid UUID v4, the
 * server reuses it (the client persisted-it-out-of-band path after a WS
 * welcome frame's `mintedAt: 'ws-onConnect'` discriminator told it to
 * POST). When absent or malformed, the server mints a fresh UUID v4 (the
 * "give me a new session" path for an explicit log-out-and-log-in
 * affordance — not surfaced in v1 UI, reserved for future use).
 *
 * Empty body `{}` is permitted — Zod's `.partial()` would over-permit
 * additional keys; explicit `optional()` on the single field keeps the
 * surface minimal.
 */
export const sessionCreateRequestSchema = z.object({
  sessionId: sessionIdSchema.optional(),
});

export type SessionCreateRequest = z.infer<typeof sessionCreateRequestSchema>;
