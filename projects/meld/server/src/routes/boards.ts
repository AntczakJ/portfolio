import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import { getDb } from '../db';
import { boards } from '../db/schema/boards';
import { type MeldWsServer } from '../lib/ws/server';
import {
  boardErrorResponseSchema,
  boardIdParamSchema,
  createBoardRequestSchema,
  createBoardResponseSchema,
  getBoardResponseSchema,
  type BoardErrorResponse,
  type CreateBoardResponse,
  type GetBoardResponse,
} from '../lib/schemas/boards';
import {
  extractClientIp,
  getBoardCreateRateLimit,
} from '../lib/rate-limit/ip-rate-limit';

/**
 * Board CRUD HTTP routes (Task 1.6).
 *
 * Scope per ADR-001..006:
 *
 *  - `POST /api/boards` — anyone can create a board (no auth in v1 per
 *    ADR-001). Returns the new board id + name + createdAt. Rate-limited
 *    by `IpRateLimit` (30/hour/IP default).
 *  - `GET /api/boards/:boardId` — returns board metadata plus
 *    `connectedClients` from the Hocuspocus room registry. The Yjs
 *    document state is NOT served over HTTP — ADR-002 pins that as the
 *    WS path's territory.
 *
 *  Out of scope here (do NOT add):
 *
 *   - Yjs document binary in either response.
 *   - Auth / ownership checks. v1 is open-link share (ADR-005).
 *   - `DELETE`. v1 retention is the 30-day inactivity sweep (ADR-003).
 *
 * Structural pattern: the routes are factored into `createBoardsRoutes()`
 * which accepts the `meldWs` server instance as a dependency. This keeps
 * the WS-aware `connectedClients` count testable in isolation (a mock WS
 * server can be passed in) and avoids the route file from reaching into
 * `server.ts`'s module-level singleton.
 *
 * The factory returns a `Hono` sub-app mounted at `/api/boards` (the
 * caller does `app.route('/api/boards', createBoardsRoutes(meldWs))`).
 * The web side reaches the routes via `api.api.boards.$post(...)` /
 * `api.api.boards[':boardId'].$get(...)` — the chain reflects the
 * `app.route('/api', ...)` mount in `server.ts` plus the `.post('/')`
 * and `.get('/:boardId')` registrations here.
 */

/**
 * Playful defaults for board names when the client omits one on create.
 * Cycled deterministically by `minute-of-day mod count` so two creates
 * within the same minute get the same name (visually consistent for
 * back-to-back testing) and the rotation walks through the set
 * predictably across the day.
 *
 * 8 entries chosen as a balance between visual variety on a casual
 * tour through the demo and the deterministic-cycle property; with
 * 1440 minutes/day and 8 names, each name surfaces ~180 times/day at
 * the modulo step.
 *
 * Convention: lowercase first word, English, no emojis (CLAUDE.md § 2 +
 * AGENT_NOTES.md "No emojis anywhere"). Strings deliberately kept under
 * 16 chars so they fit the share-dialog title slot without truncation.
 */
const DEFAULT_BOARD_NAMES = [
  'Untitled board',
  'Fresh canvas',
  'New idea',
  'Blank slate',
  'Open studio',
  'Quick sketch',
  'Notebook',
  'Drafting table',
] as const;

/**
 * Pick a default board name from `DEFAULT_BOARD_NAMES` using the current
 * minute-of-day as the index. Exported so the route handler stays small
 * and tests can pin a known minute via the optional `now` arg.
 *
 * `Date.UTC` is intentionally not used — the cycle is purely about
 * visual variety so a wall-clock-local minute is fine.
 */
export function pickDefaultBoardName(now: Date = new Date()): string {
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const idx = minuteOfDay % DEFAULT_BOARD_NAMES.length;
  // Guaranteed in-bounds by the modulo, but
  // `noUncheckedIndexedAccess: true` (tsconfig.base.json) requires the
  // fallback so the return type stays `string`.
  return DEFAULT_BOARD_NAMES[idx] ?? DEFAULT_BOARD_NAMES[0];
}

/**
 * Resolve `connectedClients` for a board from the Hocuspocus document
 * map. Returns 0 when the document is not in memory (a board that has
 * never been opened over WS, or one whose GC grace window elapsed).
 *
 * Hocuspocus's `Document` exposes `getConnectionsCount()` per the
 * upstream type definitions verified in Task 1.4. Reading the count is
 * a synchronous `Map.size`-equivalent — safe inside an HTTP request
 * handler.
 */
function countConnectedClients(
  meldWs: MeldWsServer,
  boardId: string,
): number {
  const doc = meldWs.hocuspocus.documents.get(boardId);
  return doc?.getConnectionsCount() ?? 0;
}

/**
 * Build the `/api/boards` sub-app. The caller mounts it under `/api` so
 * the final paths are `POST /api/boards` and `GET /api/boards/:boardId`.
 *
 * The Hono RPC client on the web side (`meld-web/src/lib/api/client.ts`)
 * picks up the routes automatically via the inferred `App` type re-
 * exported from `meld-server/src/app.ts`.
 */
export function createBoardsRoutes(meldWs: MeldWsServer) {
  const rateLimit = getBoardCreateRateLimit();

  return new Hono()
    .post(
      '/',
      zValidator('json', createBoardRequestSchema, (result, c) => {
        if (!result.success) {
          const body: BoardErrorResponse = boardErrorResponseSchema.parse({
            error: 'invalid-request',
          });
          return c.json(body, 400);
        }
        return undefined;
      }),
      async (c) => {
        const ip = extractClientIp(c.req.raw.headers);
        if (!rateLimit.allow(ip)) {
          const body: BoardErrorResponse = boardErrorResponseSchema.parse({
            error: 'rate-limit-exceeded',
          });
          return c.json(body, 429);
        }

        const { name: providedName } = c.req.valid('json');
        const name = providedName ?? pickDefaultBoardName();

        const db = getDb();
        const [row] = await db
          .insert(boards)
          .values({ name })
          .returning({
            id: boards.id,
            name: boards.name,
            createdAt: boards.createdAt,
          });

        if (!row) {
          // Drizzle's `.returning()` should always yield one row on a
          // successful insert; this branch is defensive against a future
          // refactor that adds a conditional insert. Surface as a 500
          // rather than swallow.
          throw new Error('board insert returned no row');
        }

        const payload: CreateBoardResponse = createBoardResponseSchema.parse({
          boardId: row.id,
          name: row.name,
          createdAt: row.createdAt.getTime(),
        });
        return c.json(payload, 201);
      },
    )
    .get(
      '/:boardId',
      zValidator('param', boardIdParamSchema, (result, c) => {
        if (!result.success) {
          const body: BoardErrorResponse = boardErrorResponseSchema.parse({
            error: 'invalid-request',
          });
          return c.json(body, 400);
        }
        return undefined;
      }),
      async (c) => {
        const { boardId } = c.req.valid('param');

        const db = getDb();
        const [row] = await db
          .select({
            id: boards.id,
            name: boards.name,
            createdAt: boards.createdAt,
            lastActiveAt: boards.lastActiveAt,
          })
          .from(boards)
          .where(eq(boards.id, boardId))
          .limit(1);

        if (!row) {
          const body: BoardErrorResponse = boardErrorResponseSchema.parse({
            error: 'board-not-found',
          });
          return c.json(body, 404);
        }

        const connectedClients = countConnectedClients(meldWs, boardId);
        const payload: GetBoardResponse = getBoardResponseSchema.parse({
          boardId: row.id,
          name: row.name,
          createdAt: row.createdAt.getTime(),
          lastActiveAt: row.lastActiveAt.getTime(),
          connectedClients,
        });
        return c.json(payload);
      },
    );
}
