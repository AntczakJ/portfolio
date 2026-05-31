/**
 * Binance aggTrade -> internal row translator — Task 1.3 per ADR-001.
 *
 * Single boundary between Binance's external wire format and the two
 * internal contracts we own:
 *
 *  1. **TickRow** — the Drizzle row shape consumed by `TickWriter`
 *     (`src/lib/ingest/tick-writer.ts`). Persisted to the `ticks` table.
 *  2. **WSTickPayload** — the browser-facing tick frame consumed by
 *     `WSConnectionRegistry.broadcast()` (`src/lib/ws/connections.ts`).
 *
 * Both shapes are derived from the SAME validated Binance event. We
 * deliberately produce them in two functions rather than one combined
 * helper because the two consumers run at different times in the
 * ingestor's hot path:
 *
 *  - `aggTradeToWSTick(event)` runs first on every frame — even when
 *    DB persistence is degraded, the live chart must keep painting.
 *  - `aggTradeToTickRow(event, sessionId)` runs second — needs the
 *    active session id, which the ingestor reads off `IngestSession`.
 *
 * Keeping the two callable independently means a future failure-mode
 * change ("drop DB persistence, keep WS broadcast" or vice versa) is a
 * call-site edit rather than a translator rewrite. Both functions are
 * pure and synchronous; there is no branching on the event payload
 * beyond the aggressor flip.
 *
 * **No business logic here.** The brief is explicit: "no aggregation,
 * no footprint cell construction, no CVD math". The translator's only
 * non-trivial operation is the `m`-to-aggressor flip documented under
 * `binanceAggTradeSchema`. Cell aggregation is Task 1.5's territory
 * (the Rust hot-path worker); the live WS path emits `tick` frames
 * only in v1 (per the parent task brief's v1.0 limitation note — the
 * Phase 3 chart must handle "tape strip only, no cells" gracefully).
 *
 * Aggressor mapping cheat sheet (verbatim from
 * `schemas/binance/agg-trade.ts`):
 *
 *   m === true  -> aggressor 'sell'  (buyer is maker, taker sold)
 *   m === false -> aggressor 'buy'   (buyer is taker, taker bought)
 */

import type { BinanceAggTrade } from '../schemas/binance/agg-trade';
import type { WSTickPayload } from '../schemas/ws';

import type { TickRow } from './tick-writer';

/**
 * Translate a validated Binance aggTrade event to the persisted tick
 * row shape. The `sessionId` is provided by the ingestor at call time;
 * the translator does not reach for it itself because the persistence
 * lifecycle (when sessions open / close) is the ingestor's concern,
 * not the translator's.
 *
 * The mapping is straight-line:
 *   - `ts_ms` <- `T` (matching-engine trade time, ADR-005 partition column).
 *   - `symbol` <- `s` (Binance reports `'BTCUSDT'`; the ingestor
 *     normalises to `'BTCUSDT-PERP'` BEFORE calling here per the
 *     PLAN.md single-symbol convention — see `binance-ingestor.ts`).
 *   - `price` / `qty` <- `p` / `q` already coerced to `number` by the
 *     Zod schema.
 *   - `aggressor` <- maker-flag flip per the cheat sheet above.
 *   - `session_id` <- caller-supplied UUID.
 */
export function aggTradeToTickRow(
  event: BinanceAggTrade,
  sessionId: string,
  symbol: string,
): TickRow {
  return {
    tsMs: event.T,
    symbol,
    price: event.p,
    qty: event.q,
    aggressor: event.m ? 'sell' : 'buy',
    sessionId,
  };
}

/**
 * Translate a validated Binance aggTrade event to the browser-facing
 * `WSTickPayload` shape per ADR-006 + `schemas/ws/tick.ts`. The WS
 * envelope (`{ topic: 'ticks.btc', kind: 'tick', payload }`) is the
 * ingestor's responsibility; this function returns the payload only.
 *
 * Notably absent from the WS payload: `symbol`, `sessionId`. The
 * envelope's `topic` already carries symbol routing in the v1 single-
 * symbol world (`ticks.btc`); `sessionId` is a server-side persistence
 * concept, not a browser-relevant one.
 */
export function aggTradeToWSTick(event: BinanceAggTrade): WSTickPayload {
  return {
    tsMs: event.T,
    price: event.p,
    qty: event.q,
    aggressor: event.m ? 'sell' : 'buy',
  };
}
