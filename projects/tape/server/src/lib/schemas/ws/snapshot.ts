import { z } from 'zod';

import { wsCellClosePayloadSchema, wsCellDeltaPayloadSchema } from './cell';
import { wsTickPayloadSchema } from './tick';

/**
 * Server-pushed initial state on WS connect (or on a reconnect
 * triggered by `CloseEvent.code = 4290`). Pinned now rather than
 * deferred so Task 1.6b (server WS handler) and Task 2.6 (browser
 * client) can ship in parallel — both have a concrete first-paint
 * contract to wire against per ADR-006 § Decision.
 *
 * Frame sequencing rule on the wire (browser-side reducer
 * invariant):
 *
 *   snapshot                        ─── baseline established
 *     ↓
 *   cell.delta, cell.delta, …       ─── additive mutations
 *     ↓                                  (open bar inside the snapshot)
 *   cell.close                      ─── absolute rebase at bar boundary
 *     ↓                                  (supersedes the open bar)
 *   cell.delta, cell.delta, …       ─── next open bar
 *     ↓
 *   …
 *
 * The snapshot is the only state-restoring frame. `cell.delta` and
 * `cell.close` are mutation reducers built on the snapshot's
 * baseline. On a reconnect the client discards local state, awaits
 * the next snapshot, and rebuilds — matches ADR-006's circuit
 * breaker → snapshot recovery path.
 *
 * Snapshot composition:
 *  - `symbol`         — Exchange-qualified symbol; v1 hard-pinned to
 *                       `'BTCUSDT-PERP'` (single-symbol v1 per
 *                       PLAN.md). v2 multi-symbol turns this into a
 *                       per-topic snapshot; the schema does not need
 *                       to change.
 *  - `currentBarTs`   — Ms-since-epoch start of the bar that is
 *                       currently OPEN at snapshot emit time. The
 *                       browser uses this to anchor the right edge
 *                       of the chart before any deltas arrive.
 *  - `cells`          — Most-recent closed cells, ordered oldest →
 *                       newest by `bucketTs`. Carries absolute
 *                       totals (uses `wsCellClosePayloadSchema`).
 *  - `cellsOpen`      — Deltas accumulated on the currently-open bar
 *                       prior to snapshot emit (uses
 *                       `wsCellDeltaPayloadSchema`). Lets the
 *                       browser render the partial right-edge bar
 *                       on first paint — the wow moment cannot wait
 *                       a full minute for `currentBarTs + 60 000` to
 *                       fire the first `cell.close`.
 *  - `recentTicks`    — Most-recent ticks for the tape strip,
 *                       ordered oldest → newest by `tsMs`. Same
 *                       per-tick schema as the live `tick` frame.
 *
 * **v1 pin counts (rationale documented inline for the next
 * agent who asks "why 120 / 200" on a code review).**
 *
 *  - **120 cells.** At BTC-PERP $5 price buckets × 1-minute time
 *    buckets, an active bar holds 40–80 price levels (per ADR-002 §
 *    Context). 120 cells covers ~2 full closed bars worth of
 *    visible history, which is what the chart's right edge actually
 *    paints on first load (~one open + one previous). Going below
 *    100 leaves the previous bar's right edge bare during a
 *    reconnect; going above ~200 starts paying snapshot wire bytes
 *    for off-screen history that replay-mode (Task 1.7) is the
 *    right path for.
 *
 *  - **200 ticks.** Tape strip in the chart UI shows ~50–80 visible
 *    rows on a 1440px-tall desktop viewport (Task 3.3 will pin the
 *    exact virtualisation cap). 200 ticks covers 2–4× viewport
 *    height — comfortable for a first-paint scroll-up reaction
 *    without paying for ~1 KB+ of off-screen history per reconnect.
 *
 *  Combined snapshot wire estimate (post-msgpackr compression, per
 *  ADR-006 § Context): 120 cells × ~50 B + 200 ticks × ~40 B ≈
 *  ~14 KB on the wire — squarely inside ADR-006's ~12–14 KB pin.
 *
 *  Constants exported so Task 1.6b's snapshot builder reads them
 *  from the schema module rather than re-declaring them at the
 *  call site (one source of truth; a future v1.x cap change is a
 *  single edit). NOT enforced by the schema as a `.length` /
 *  `.max()` because (a) ramp-up on a fresh worker has fewer cells
 *  available, (b) the cap is a server-side budget, not a wire
 *  invariant the client must verify.
 */

/** v1 snapshot pin — most-recent N closed cells included on connect. */
export const WS_SNAPSHOT_CELLS_PIN = 120;

/** v1 snapshot pin — most-recent N ticks included on connect. */
export const WS_SNAPSHOT_TICKS_PIN = 200;

export const wsSnapshotPayloadSchema = z.object({
  symbol: z.string().min(1),
  currentBarTs: z.number().int().positive(),
  cells: z.array(wsCellClosePayloadSchema),
  cellsOpen: z.array(wsCellDeltaPayloadSchema),
  recentTicks: z.array(wsTickPayloadSchema),
});

export type WSSnapshotPayload = z.infer<typeof wsSnapshotPayloadSchema>;
