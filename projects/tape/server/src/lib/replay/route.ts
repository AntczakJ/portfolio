import { Elysia } from 'elysia';

import {
  computeReplayBounds,
  computeTickWindow,
  type ReplayBounds,
} from './bounds';
import { ndjsonStream } from './ndjson';
import { streamReplayCells, streamReplayTicks } from './query';
import { replayCellRowSchema, type ReplayCellRow } from '../schemas/replay/cell';
import { replayTickRowSchema, type ReplayTickRow } from '../schemas/replay/tick';

/**
 * Historic replay routes — Task 1.7. ADR-005 is the source of truth (NOT
 * PLAN.md's "data.binance.vision archive" line — see the replay schema
 * docblocks and the Task 1.7 report for the deviation note). Replay reads
 * **local Postgres only**: `footprint_cells` for the cell stream and
 * `ticks` for the tape strip's bounded sliding window. This is the
 * offline-safe half of the ADR-005 live/replay read-split (live = worker
 * memory, replay = Postgres only).
 *
 * Two routes:
 *
 *   GET /api/replay/:symbol/:date
 *     → chunked NDJSON stream of the day's footprint cells, ordered by
 *       `(bucket_ts, price_bucket)`. One `replayCellRowSchema`-shaped JSON
 *       object per line. ~72K rows worst case — STREAMED off a postgres-js
 *       cursor, never buffered (ADR-005 § "Replay query shape").
 *
 *   GET /api/replay/:symbol/:date/ticks?from=&to=
 *     → chunked NDJSON stream of the raw-tick tail for the tape strip,
 *       bounded to the `[from, to)` window (clamped to the day),
 *       ordered by `ts_ms`. One `replayTickRowSchema`-shaped JSON object
 *       per line. The sibling-endpoint design (Task 1.7 option (b)) keeps
 *       the cell stream clean and lets Task 3.6 scrub by fetching only the
 *       ticks around the replay cursor — no full-day re-download.
 *
 * **Validation / error contract (fail-closed).**
 *  - Malformed `:symbol` (off the v1 allowlist) or `:date` (not strict
 *    `YYYY-MM-DD` UTC, or not a real calendar day) → **400** with a typed
 *    `{ error: { field, message } }` body. The validation is pure
 *    (`bounds.ts`) and unit-tested independent of the DB.
 *  - A malformed `?from=` / `?to=` window (non-integer, negative,
 *    inverted) → **400** with `field: 'window'`.
 *  - A well-formed day with no persisted rows → **200** with an EMPTY
 *    NDJSON body (zero lines). Chosen over 404: an empty stream is
 *    friendlier for the client (Task 3.6's reducer treats zero lines as
 *    "nothing to render for this day" without a branch on a 404 status),
 *    and "no cells yet" is a legitimate state for today's date before the
 *    first bar closes — not an error.
 *
 * **Why the NDJSON body is validated server-side at the boundary.** The
 * per-line schema is parsed (`replayCellRowSchema.parse` /
 * `replayTickRowSchema.parse`) before serialisation, so a future query
 * refactor that breaks the row shape throws loudly here rather than
 * shipping a malformed line the client silently mis-parses. The cost is
 * one Zod parse per row; at ~72K rows that is the dominant CPU cost of
 * the stream, accepted because correctness-at-the-boundary
 * (docs/conventions.md § 5) outranks shaving microseconds off an offline
 * replay path that is not on the 60 fps live hot path.
 */

/** NDJSON media type (newline-delimited JSON, one object per `\n`). */
const NDJSON_CONTENT_TYPE = 'application/x-ndjson';

const NDJSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': NDJSON_CONTENT_TYPE,
  // Disable proxy/browser buffering so each chunk reaches the client as
  // produced (the Fly edge + any intermediary honour this).
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

/** 400 JSON error body, typed for Eden Treaty inference. */
function badRequest(
  set: { status?: number | string },
  field: 'symbol' | 'date' | 'window',
  message: string,
): { error: { field: 'symbol' | 'date' | 'window'; message: string } } {
  set.status = 400;
  return { error: { field, message } };
}

export const replayRoutes = new Elysia({ name: 'replay-routes' })
  /**
   * Cell stream. `:symbol` / `:date` validated fail-closed; on success a
   * chunked NDJSON `Response` streams the day's cells.
   */
  .get('/api/replay/:symbol/:date', ({ params, set }) => {
    const result = computeReplayBounds(params.symbol, params.date);
    if (!result.ok) {
      return badRequest(set, result.field, result.message);
    }
    const bounds: ReplayBounds = result.bounds;
    return new Response(
      ndjsonStream<ReplayCellRow>(streamReplayCells(bounds), (row) =>
        replayCellRowSchema.parse(row),
      ),
      { headers: NDJSON_HEADERS },
    );
  })
  /**
   * Tick-tail window. Same `:symbol` / `:date` validation, plus a
   * `?from=&to=` window clamped to the day bounds.
   */
  .get('/api/replay/:symbol/:date/ticks', ({ params, query, set }) => {
    const result = computeReplayBounds(params.symbol, params.date);
    if (!result.ok) {
      return badRequest(set, result.field, result.message);
    }
    const bounds: ReplayBounds = result.bounds;
    const window = computeTickWindow(bounds, query.from, query.to);
    if (window === null) {
      return badRequest(
        set,
        'window',
        "Malformed tick window. 'from' / 'to' must be non-negative integer epoch-ms with from <= to.",
      );
    }
    return new Response(
      ndjsonStream<ReplayTickRow>(streamReplayTicks(bounds, window), (row) =>
        replayTickRowSchema.parse(row),
      ),
      { headers: NDJSON_HEADERS },
    );
  });
