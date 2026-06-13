import { z } from 'zod';

/**
 * Replay cell row — one NDJSON line of the historic replay stream
 * (Task 1.7, `GET /api/replay/:symbol/:date`).
 *
 * **Source of truth: ADR-005, NOT PLAN.md.** PLAN.md Task 1.7 says the
 * replay endpoint is "sourced from data.binance.vision archive". ADR-005
 * § "Read path split" overrides that: replay reads from **local Postgres
 * only** — `footprint_cells` for this cell stream and `ticks` for the
 * tape strip's sliding window (the sibling `/ticks` route). The archive
 * ingestion path is a separate, deferred capability and is out of scope
 * for this task. This is the offline-safe, live/replay read-split design
 * (live = worker memory, replay = Postgres only) that ADR-005 ratified.
 *
 * **Why a replay-specific row schema and not the WS `cell.close` schema
 * directly.** ADR-006's `cell.close` payload (`src/lib/schemas/ws/cell.ts`)
 * carries `symbol` + absolute totals (`bidVolume` / `askVolume` /
 * `trades`) but NOT `delta`. The persisted `footprint_cells` row
 * (ADR-005, `src/db/schema/footprint-cells.ts`) carries `delta` only as a
 * read-time projection (`ask_volume - bid_volume AS delta` — the STORED
 * generated column ADR-005 specced was dropped from the row to save write
 * cost, computed in the SELECT instead). The replay stream wants `delta`
 * on the wire so the renderer does not recompute it per row across ~72K
 * rows. So this line shape = the `cell.close` TOTALS field names
 * (`bidVolume` / `askVolume` / `trades`, NOT the `*Delta` mutation field
 * names) PLUS the projected `delta`. It is deliberately NOT a third cell
 * shape: every field name here is identical to `wsCellClosePayloadSchema`
 * except for the added `delta`, so a consumer that already parses
 * `cell.close` reads a replay row with zero new field vocabulary.
 *
 * **Field-name alignment is load-bearing.** Per the Task 1.7 brief and
 * the `ws/cell.ts` docblock invariant: replay rows carry the
 * close-totals field names (`bidVolume` / `askVolume` / `trades`), NEVER
 * the delta names. A frontend agent must be able to feed a replay row
 * through the SAME "absolute rebase" reducer it uses for `cell.close`
 * (state REPLACED, not accumulated) — replay bars are already closed, so
 * there is no delta accumulation in replay (ADR-006 § "replay.bar" note).
 *
 * **`priceBucket` is the integer bucket INDEX, not a USD price.** Matches
 * `footprint_cells.price_bucket` (bigint, `mode: 'number'`) and the WS
 * `cell.close` `priceBucket`. Multiply by `PRICE_BUCKET_USD` (=5 on
 * BTC-PERP, `lib/aggregator/bucketing.ts`) to recover the lower-bound
 * price of the bucket. Carried as `number`: bucket indices stay far
 * inside `Number.MAX_SAFE_INTEGER`.
 *
 * **Numeric precision.** Volumes + delta are `number` (JS f64), the same
 * floor as the persisted Postgres `double precision` columns and the WS
 * frame. `delta` is the only signed field (bid-heavy bars are negative).
 *
 * Field map:
 *  - `symbol`      — Exchange-qualified symbol, e.g. 'BTCUSDT-PERP'.
 *  - `bucketTs`    — Start of the 1-min time bucket, ms since epoch (UTC).
 *  - `priceBucket` — Price-bucket index (see above).
 *  - `bidVolume`   — Absolute total bid volume for the bar. Non-negative.
 *  - `askVolume`   — Absolute total ask volume for the bar. Non-negative.
 *  - `trades`      — Absolute total trade count. Non-negative int.
 *  - `delta`       — `askVolume - bidVolume`. Signed finite f64. Projected
 *                    in the SELECT, not stored.
 */
export const replayCellRowSchema = z.object({
  symbol: z.string().min(1),
  bucketTs: z.number().int().positive(),
  priceBucket: z.number(),
  bidVolume: z.number().nonnegative(),
  askVolume: z.number().nonnegative(),
  trades: z.number().int().nonnegative(),
  delta: z.number(),
});

export type ReplayCellRow = z.infer<typeof replayCellRowSchema>;
