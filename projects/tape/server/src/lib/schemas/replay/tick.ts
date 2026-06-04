import type { z } from 'zod';

import { wsTickPayloadSchema } from '../ws/tick';

/**
 * Replay tick row — one NDJSON line of the sibling tick-tail stream
 * (Task 1.7, `GET /api/replay/:symbol/:date/ticks?from=&to=`).
 *
 * **Why a sibling endpoint and not interleaving ticks into the cell
 * stream (the Task 1.7 (a)-vs-(b) choice).** ADR-005 § "Replay query
 * shape" pins the tape strip's raw-tick need as "a sliding window of raw
 * ticks bounded to the last N seconds of replay-cursor time, NOT the full
 * day". Interleaving the full day's ticks (~10-20M rows) into the cell
 * NDJSON stream would (a) blow past the ~72K-cell stream by two orders of
 * magnitude, defeating the < 5 s scrub budget, and (b) force the client
 * to re-download the entire day to scrub to any position. A bounded
 * `?from=&to=` window endpoint lets Task 3.6 pull only the ticks around
 * the current replay cursor — one small request per scrub window, no
 * full-day re-download, and the cell NDJSON stream stays clean (cells
 * only, ordered, streamable). This is option (b) from the Task 1.7 brief.
 *
 * **Row shape = the WS `tick` payload (NOT a third tick shape).** The
 * replay tick line is structurally identical to `wsTickPayloadSchema`
 * (`src/lib/schemas/ws/tick.ts`) — `tsMs` / `price` / `qty` / `aggressor`
 * — so Task 3.6 feeds replay tick rows through the SAME tape-strip
 * reducer it uses for live `tick` frames. We re-export the WS tick schema
 * under a replay alias rather than redeclaring it, so the two cannot
 * drift. The persisted `ticks` row (`src/db/schema/ticks.ts`) carries
 * `symbol` + `session_id` too; the replay tick line drops those — `symbol`
 * is on the request path and `session_id` is server-internal — keeping
 * the line byte-identical to the live tick the renderer already knows.
 *
 * **Aggressor mapping (canonical, restated so a reader of this file does
 * not have to traverse to the ingest translator).** The persisted
 * `ticks.aggressor` column is already the resolved `'buy' | 'sell'` taker
 * side (Binance `m === true → 'sell'`, `m === false → 'buy'`, mapped at
 * ingest in `lib/ingest/binance-translator.ts`). The replay SELECT reads
 * the column straight through — no re-derivation, no `is_buyer_maker`
 * round-trip.
 */
export const replayTickRowSchema = wsTickPayloadSchema;

export type ReplayTickRow = z.infer<typeof replayTickRowSchema>;
