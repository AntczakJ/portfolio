import { z } from 'zod';

/**
 * Binance Futures `<symbol>@aggTrade` event — Task 1.3 per ADR-001.
 *
 * This schema validates the RAW JSON frame Binance pushes over
 * `wss://fstream.binance.com/ws/<symbol>@aggTrade`. It lives under
 * `src/lib/schemas/binance/` rather than `src/lib/schemas/ws/` because
 * it is an EXTERNAL-source contract — the wire format is owned by
 * Binance, not by us. The internal browser-facing tick contract
 * (`wsTickPayloadSchema`) lives in `schemas/ws/tick.ts` and the
 * persisted Drizzle row in `db/schema/ticks.ts`. The translator at
 * `lib/ingest/binance-translator.ts` is the boundary that converts
 * this external shape into both internal shapes.
 *
 * **Wire shape (Binance public docs, USDM Futures stream, verified
 * against the official documentation as of 2026-05-29):**
 *
 *   {
 *     "e": "aggTrade",   // event type
 *     "E": 1735689600000, // event time (server publish ms)
 *     "s": "BTCUSDT",    // symbol
 *     "a": 12345,        // aggregate trade id
 *     "p": "71234.50",   // price as decimal string
 *     "q": "0.001",      // quantity as decimal string
 *     "f": 100,          // first trade id in the aggregate
 *     "l": 105,          // last trade id in the aggregate
 *     "T": 1735689599998, // trade time (matching engine ms — earlier than `E`)
 *     "m": true          // is the buyer the market maker?
 *   }
 *
 * **`p` and `q` are STRINGS on the wire.** Binance reports decimals as
 * strings so the JSON does not lose precision via JS f64. We Zod-coerce
 * them to `number` (f64) at the boundary because:
 *   - BTC-PERP price has at most 2 decimal places and a 6-digit integer
 *     part — well inside f64 safe-integer range with 9+ orders of magnitude
 *     of mantissa headroom.
 *   - The downstream consumers (renderer, Drizzle `doublePrecision`,
 *     `wsTickPayloadSchema`) all use `number`. Carrying a string this far
 *     would force a one-off coercion in every consumer for zero
 *     correctness win at our scale.
 *
 * **`m` semantics (aggressor mapping).** Binance's docs are explicit:
 * `m = true` means the BUYER is the market maker, which means the
 * incoming taker order was a SELL (a market-sell that hit the bid).
 * `m = false` means the buyer was the taker — the incoming order was
 * a market BUY. The translator maps:
 *   - `m === true`  -> aggressor `'sell'` (taker sold)
 *   - `m === false` -> aggressor `'buy'`  (taker bought)
 * This convention matches every downstream cell-aggregation rule
 * (footprint bid volume comes from taker-sells, ask volume from
 * taker-buys; CVD adds buys, subtracts sells).
 *
 * **`T` vs `E`.** `T` is the matching-engine trade time and is the
 * authoritative tick timestamp — it is the time at which the trade
 * actually happened on the exchange. `E` is Binance's publish time, a
 * few ms later. ADR-005's `ticks.ts_ms` partition column is the trade
 * time, so the translator uses `T`. `E` is captured for diagnostic
 * latency observability but not persisted.
 *
 * **`f` / `l`.** First and last trade id of the underlying aggregate.
 * Binance's gap-detection guidance is "watch the monotonic `a` field
 * across consecutive frames"; a missing `a` means we dropped frames and
 * the in-memory cell state is stale. v1 does NOT implement gap
 * detection — the synthesizer-replacement spec for Task 1.3 (this
 * task) does not require it, and a missing tick is acceptable in v1
 * per the PLAN.md "Out of scope" frame. v2 conversation, not v1.
 *
 * **Zod `coerce` choice.** We use `z.coerce.number()` rather than
 * `z.string().transform(parseFloat)` because (a) the wire is reliably
 * decimal-string and JS `Number(...)` handles every representable form
 * (including `'71234.50'`, `'1e5'`, `'1.5e-3'`), (b) Zod's coerce path
 * surfaces NaN / Infinity as a `.finite()` check failure, which we then
 * gate via the same `.finite()` constraint, so a malformed string
 * surfaces as a clean schema error rather than a silent `NaN` in the
 * tick ring.
 *
 * **`.strict()` is intentionally NOT used.** Binance has historically
 * added new fields to event payloads (`r` for liquidation-related
 * aggregates, `X` placeholders on some streams) without bumping the
 * stream version. A strict schema would reject every such addition as a
 * parse error and stall ingest until we ship a code change. Permissive
 * decode + explicit field consumption is the right boundary policy for
 * an external feed we do not own.
 */
export const binanceAggTradeSchema = z.object({
  e: z.literal('aggTrade'),
  E: z.number().int().positive(),
  s: z.string().min(1),
  a: z.number().int().nonnegative(),
  p: z.coerce.number().positive().finite(),
  q: z.coerce.number().positive().finite(),
  f: z.number().int().nonnegative(),
  l: z.number().int().nonnegative(),
  T: z.number().int().positive(),
  m: z.boolean(),
});

export type BinanceAggTrade = z.infer<typeof binanceAggTradeSchema>;
