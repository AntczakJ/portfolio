import { z } from 'zod';

/**
 * Zod schemas for the board CRUD HTTP surface (Task 1.6).
 *
 * Per docs/conventions.md § 5, `src/lib/schemas/` is the integration
 * boundary — the same files validate the request on the server (via
 * `@hono/zod-validator`) and feed the inferred response types into the
 * Hono RPC client on the web side. The Drizzle-derived schemas in
 * `src/lib/schemas/db/boards.ts` cover the row shape; this file covers
 * the HTTP transport shape (request bodies, response payloads, path
 * params).
 *
 * Scope kept tight per ADR-001..006:
 *
 *  - No auth fields. v1 has no accounts (ADR-001 + ADR-005). Anyone with
 *    the board URL has access. The rate limit on `POST /api/boards`
 *    (`src/lib/rate-limit/ip-rate-limit.ts`) is the only abuse mitigation.
 *  - No Yjs state in the HTTP payload. ADR-002 / ADR-003 pin the Yjs
 *    document binary as the WS path's concern; HTTP routes only see
 *    metadata.
 *  - No `DELETE`. v1 retention is the 30-day inactivity sweep (ADR-003)
 *    — boards live forever from a client's perspective until then.
 *
 * Naming convention:
 *
 *  - `boardId` exposed as `string` (UUID v4) over the wire. The Postgres
 *    column is `uuid` (Task 1.2) and Drizzle's `defaultRandom()` populates
 *    it; the route validates the path param against a UUID v4 regex.
 *  - `createdAt` / `lastActiveAt` exposed as numeric millisecond epochs
 *    (matches `/health.ts` `ts` convention — single time format across
 *    the API). Drizzle `timestamp({ mode: 'date' })` returns `Date`; the
 *    route handler coerces with `.getTime()` before validating outbound.
 *  - `connectedClients` exposed as `number` (integer ≥ 0). Read from
 *    Hocuspocus's per-document `connections.size`-equivalent at request
 *    time. The number is point-in-time and may differ between two GETs
 *    a second apart — that is expected for an observability field.
 */

/**
 * Request body for `POST /api/boards`.
 *
 * `name` is optional — when absent the server picks a playful default
 * (see `pickDefaultBoardName` in `src/routes/boards.ts`). The 80-char
 * upper bound is a courtesy ceiling; v1 has no enforced board-naming
 * convention. Empty strings are rejected so a client cannot create a
 * "nameless" board that the avatar stack / share dialog would render as
 * a blank.
 */
export const createBoardRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name cannot be empty when provided')
    .max(80, 'name must be 80 characters or fewer')
    .optional(),
});

export type CreateBoardRequest = z.infer<typeof createBoardRequestSchema>;

/**
 * Response from `POST /api/boards`.
 *
 * Returned with HTTP 201. The web client gets back the board id (which
 * doubles as the URL slug for `/board/[boardId]`), the resolved name
 * (server-picked default OR client-supplied), and the creation timestamp.
 *
 * `connectedClients` is intentionally NOT on the create response — at
 * the instant the row is inserted, the creating tab has not yet opened
 * the WS for it. The next `GET /api/boards/:boardId` reports it.
 */
export const createBoardResponseSchema = z.object({
  boardId: z.uuid(),
  name: z.string().min(1).max(80),
  createdAt: z.number().int().positive(),
});

export type CreateBoardResponse = z.infer<typeof createBoardResponseSchema>;

/**
 * UUID v4 regex matching `crypto.randomUUID()` output. Used by the path
 * param validator on `GET /api/boards/:boardId`.
 *
 * Aligns with ADR-005's cookie validation regex; if either schema's
 * regex changes the other should track. Mirror the rule, do NOT factor
 * into a shared `isUuidV4()` helper until a third call site exists
 * (`docs/conventions.md` § 13 extraction trigger).
 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Path param schema for `GET /api/boards/:boardId`.
 *
 * `@hono/zod-validator` validates against this and emits a structured
 * 400 on miss. Without the regex check the route would reach the DB
 * with garbage strings; rejecting at the boundary keeps the DB free of
 * "lookup never possible" round trips.
 */
export const boardIdParamSchema = z.object({
  boardId: z.string().regex(UUID_V4_REGEX, 'boardId must be a UUID v4'),
});

export type BoardIdParam = z.infer<typeof boardIdParamSchema>;

/**
 * Response from `GET /api/boards/:boardId`.
 *
 * Same metadata as `POST /api/boards` plus `lastActiveAt` (touched on
 * every `onChange` per ADR-003) and `connectedClients` (point-in-time
 * Hocuspocus room population). `connectedClients` lets the share-dialog
 * UI show "3 other tabs are open" before the WS handshake completes —
 * if the request is the first thing the tab does, the count is what
 * the WS layer will see plus the connecting tab.
 */
export const getBoardResponseSchema = z.object({
  boardId: z.uuid(),
  name: z.string().min(1).max(80),
  createdAt: z.number().int().positive(),
  lastActiveAt: z.number().int().positive(),
  connectedClients: z.number().int().nonnegative(),
});

export type GetBoardResponse = z.infer<typeof getBoardResponseSchema>;

/**
 * Structured error shape returned by the board routes.
 *
 * All 4xx responses go through this shape so the web client has a
 * single union to discriminate on. Keeping it minimal — `error` is a
 * dash-cased kind literal, no `message` field because the web layer
 * surfaces user-facing copy from its own i18n catalog (v2 candidate)
 * keyed on the kind. v1 logs the kind to the console; that is enough
 * for a portfolio demo.
 *
 * Kinds in use:
 *
 *  - `'board-not-found'` — `GET /api/boards/:boardId` against a uuid
 *    not in the table. HTTP 404.
 *  - `'rate-limit-exceeded'` — `POST /api/boards` over the per-IP
 *    window cap. HTTP 429.
 *  - `'invalid-request'` — Zod boundary failure. HTTP 400. The Zod
 *    issues array is attached as `issues` for debugging only.
 */
export const boardErrorResponseSchema = z.object({
  error: z.enum([
    'board-not-found',
    'rate-limit-exceeded',
    'invalid-request',
  ]),
});

export type BoardErrorResponse = z.infer<typeof boardErrorResponseSchema>;
