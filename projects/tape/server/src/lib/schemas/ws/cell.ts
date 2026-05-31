import { z } from 'zod';

/**
 * Footprint cell payloads — `cell.delta` (mid-bar mutation) and
 * `cell.close` (bar-boundary absolute totals). Two payloads, one
 * canonical correctness invariant:
 *
 * **ADR-005 + ADR-006 invariant — non-overlapping field names.**
 * The kind discriminator on the envelope ALREADY distinguishes a
 * delta from a close at runtime, but a future reader scanning a
 * hexdump or a `msgpack2json` capture must also see distinct field
 * tokens for the totals-vs-delta semantics. So we name the delta
 * fields `bidVolumeDelta` / `askVolumeDelta` / `tradesDelta` and the
 * close fields `bidVolume` / `askVolume` / `trades`. A frontend agent
 * who tries to apply a `cell.close` payload through an
 * `applyCellDelta` reducer gets a Zod parse error, not a silent
 * miscount in production. The cell coordinates (`bucketTs`,
 * `priceBucket`) DO overlap because they are identifiers, not
 * totals — semantic clarity is on the totals fields, where the bug
 * class lives.
 *
 * **The WS schema is INDEPENDENT of the Drizzle `footprint_cells`
 * row schema.** The persisted row (Drizzle, under
 * `src/db/schema/footprint-cells.ts` + drizzle-zod under
 * `src/lib/schemas/db/footprint-cells.ts`) carries absolute totals at
 * bar close — its shape happens to match `cell.close` payload-wise
 * but the two evolve independently. A future imbalance-percent
 * derived field on the WS frame might never land in the DB; a future
 * `session_id` FK on the row never travels over the WS. Do NOT
 * derive one from the other. Both Zod schemas exist on purpose; do
 * not import drizzle-zod into this file.
 *
 * **v1 invariant — deltas are non-negative.** A `cell.delta` is a
 * forward-additive mutation on an open bar: ticks accumulate into
 * `bidVolumeDelta` / `askVolumeDelta` / `tradesDelta` as they happen
 * on the bridge. Within v1 the worker emits one delta per
 * `(symbol, bucketTs, priceBucket)` per coalescing window (50 ms per
 * ADR-003) and the WS-side accumulator (Task 1.6b) sums multiple
 * incoming deltas for the same cell. There is no v1 path that
 * produces a negative delta — neither the bridge nor the WS
 * coalescer ever subtracts.
 *
 * v2 consideration: if a future "correction" frame surfaces (e.g.,
 * a Binance feed correction that revokes a trade after-the-fact),
 * negative deltas become a real shape. At that point this schema
 * widens `bidVolumeDelta` / `askVolumeDelta` / `tradesDelta` to
 * accept negatives by removing the `.nonnegative()` constraint, OR
 * a separate `cell.correction` kind is added under the discriminated
 * union. The choice is a v2 architect decision — recorded under
 * AGENT_NOTES "Decisions to revisit" rather than pre-allocated here.
 *
 * **Numeric precision.** Volumes are `number` (JS f64). At BTC-PERP
 * scale a single bid/ask volume per $5 price bucket per 1-min bar
 * tops out around ~10^4 BTC in volatile sessions; f64 carries 15.95
 * decimal digits of precision, which is ~10 orders of magnitude of
 * headroom. The persisted Drizzle row uses Postgres `double
 * precision`, identical floor.
 */

/**
 * Mid-bar additive mutation on the worker's current bar state.
 *
 * Sent on the live `cells.btc` topic during the open-bar window.
 * Applied by the browser as `cellState[key] += delta` for each of the
 * three numeric fields, keyed by `(bucketTs, priceBucket)` — symbol
 * lives on the envelope's `topic`.
 *
 * Field map:
 *  - `tsMs`            — Server-side observation time, ms since epoch.
 *                        Used by the browser for staleness checks /
 *                        late-frame drop logic. Positive int.
 *  - `bucketTs`        — Start of the 1-min time bucket the cell
 *                        belongs to, ms since epoch (UTC-aligned).
 *  - `priceBucket`     — Price-aligned bucket key (e.g. $5-aligned
 *                        BTC-PERP). Carried as `number` because the
 *                        renderer math is in `number` and bucket
 *                        values stay well inside Number.MAX_SAFE_INTEGER.
 *  - `bidVolumeDelta`  — Volume added to the cell's bid side this
 *                        coalescing window. Non-negative per the v1
 *                        invariant above.
 *  - `askVolumeDelta`  — Volume added to the cell's ask side. Same
 *                        non-negative constraint.
 *  - `tradesDelta`     — Trade count added to the cell. Non-negative
 *                        int.
 */
export const wsCellDeltaPayloadSchema = z.object({
  tsMs: z.number().int().positive(),
  bucketTs: z.number().int().positive(),
  priceBucket: z.number().finite(),
  bidVolumeDelta: z.number().nonnegative().finite(),
  askVolumeDelta: z.number().nonnegative().finite(),
  tradesDelta: z.number().int().nonnegative(),
});

export type WSCellDeltaPayload = z.infer<typeof wsCellDeltaPayloadSchema>;

/**
 * Bar-boundary absolute totals for a now-closed cell.
 *
 * Sent on the live `cells.btc` topic at the 1-min bar boundary
 * (per ADR-004 / ADR-005 — the closed bar is the durable source of
 * truth) and replayed by the snapshot frame for visible-history
 * cells.
 *
 * Field shape matches the persisted `footprint_cells` row
 * semantically but the schemas are independent (see file docblock
 * above). The browser uses this as a hard rebase: the cell's state
 * is REPLACED with these absolute totals, supplanting any deltas
 * that accumulated mid-bar. Carrying `symbol` on this payload is
 * intentional even though the envelope's `topic` already encodes it
 * — the snapshot frame embeds an array of close payloads, and a
 * consumer iterating the array benefits from the symbol being on
 * the payload directly (the topic is on the envelope, one level up).
 *
 * Field map:
 *  - `symbol`      — Exchange-qualified symbol, e.g. 'BTCUSDT-PERP'.
 *                    Non-empty ASCII.
 *  - `bucketTs`    — Start of the 1-min time bucket, ms since epoch.
 *  - `priceBucket` — Price-aligned bucket key.
 *  - `bidVolume`   — Absolute total bid volume for the bar.
 *                    Non-negative finite f64.
 *  - `askVolume`   — Absolute total ask volume for the bar.
 *  - `trades`      — Absolute total trade count. Non-negative int.
 */
export const wsCellClosePayloadSchema = z.object({
  symbol: z.string().min(1),
  bucketTs: z.number().int().positive(),
  priceBucket: z.number().finite(),
  bidVolume: z.number().nonnegative().finite(),
  askVolume: z.number().nonnegative().finite(),
  trades: z.number().int().nonnegative(),
});

export type WSCellClosePayload = z.infer<typeof wsCellClosePayloadSchema>;
