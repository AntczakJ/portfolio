'use client';

/**
 * useStreamStore — ephemeral domain stream state.
 *
 * **No persistence.** Closing the tab resets the store. This is
 * deliberate — the snapshot frame on connect is the authoritative
 * baseline, persisting a stale snapshot would lie about freshness on
 * the next load. `useUiStore` is the persisted store (chrome intent —
 * rail collapse, replay mode); `useStreamStore` is the live one (tick
 * count, cell map, connection status). Do NOT add `persist`
 * middleware here.
 *
 * **Ring sizes match the ADR-006 snapshot pin** so a snapshot fully
 * populates the store without leftover capacity from a previous
 * session:
 *   - `STREAM_RECENT_TICKS_CAP = 200`  (matches `WS_SNAPSHOT_TICKS_PIN`)
 *   - `STREAM_CLOSED_CELLS_CAP = 120`  (matches `WS_SNAPSHOT_CELLS_PIN`)
 *
 * Open cells live in a Map keyed by `${bucketTs}:${priceBucket}` —
 * mid-bar deltas accumulate into the existing entry; a `cell.close`
 * for that key evicts the open entry and pushes a closed payload into
 * the closed-cells ring.
 *
 * `framesPerSec` is a sliding-window observed rate over the last 5 s
 * of frame arrivals — useful for the status bar's eventual rate
 * indicator. Window is bounded so we never grow unbounded under
 * silent producers.
 *
 * `lastSnapshot` is retained so a reconnect-from-snapshot trigger
 * (server-side overrun on CloseEvent.code 4290) can replay the
 * baseline if the reducers need to seed something programmatically
 * between snapshot frames. In practice the next snapshot is the only
 * trigger that re-seeds the store.
 *
 * **Client-side CVD derivation (ADR-008).** Cumulative Volume Delta is
 * NOT on the WS wire in v1 — the Rust/server CVD is the conformance
 * reference + replay source + reserved v2 wire promotion. The browser
 * derives its own running CVD by folding `askVolume − bidVolume` per
 * `cell.close` (the same f64 data it already parses), seeded from the
 * snapshot's closed bars. This is the single client-side CVD
 * derivation site; the Phase 3.2c CVD line sub-pane consumes
 * `state.cvd` (scalar) AND `state.cvdSeries` (time series) from here
 * rather than re-folding. The fold is additive and order-independent
 * at the cell granularity (each `cell.close` is the absolute total for
 * one closed cell, so the running sum is the net delta across all
 * closed cells seen this session) — there is no float-order constraint
 * here because we are NOT trying to match the Rust per-bar fold
 * bit-for-bit on the client; the Rust copy is the canonical one for
 * conformance (ADR-008). The client CVD is a live visual aid, seeded
 * fresh on every snapshot.
 *
 * **cvdSeries ring (Task 3.2c, additive).** The scalar `cvd` is enough
 * for a status readout but the CVD line sub-pane needs a per-bar time
 * series to draw against the footprint's X-axis. `cvdSeries` is a
 * bounded ring of `{ bucketTs, cvd }` points — one point per closed
 * bar, carrying the RUNNING cumulative CVD at that bar's close.
 * Multiple `cell.close` frames for the SAME `bucketTs` (one per price
 * bucket) update the same trailing point in place (the bar is still
 * accumulating its closes); a `cell.close` for a NEW, larger
 * `bucketTs` appends a fresh point seeded from the previous running
 * value. The ring is sized to `STREAM_CLOSED_CELLS_CAP` so it covers
 * at least the same horizontal span the footprint renders. The series
 * is the seam the CVD pane consumes; it is derived in this one place,
 * never re-folded downstream. Replay (Task 3.6) reuses the identical
 * fold over historic `cell.close` / `replay.bar` frames.
 */
import { create } from 'zustand';
import { shallow } from 'zustand/shallow';
import { useShallow } from 'zustand/react/shallow';
import type {
  WSCellClosePayload,
  WSCellDeltaPayload,
  WSFrame,
  WSReplayBarPayload,
  WSSnapshotPayload,
  WSTickPayload,
} from 'tape-server';

import type { WSConnectionState } from '@/lib/ws/client';

/**
 * Closed-cell ring size. The WS snapshot pins the most-recent 120 closed
 * cells (`WS_SNAPSHOT_CELLS_PIN`) so a fresh connect seeds ~6 bars, but
 * the client retains MORE as live `cell.close` frames accrue: the
 * footprint's wow-moment window is "the last ~30 minutes" (PLAN.md), i.e.
 * ~30 one-minute bars, and at ~25 price levels per bar that needs ~750
 * cells in the ring for the chart to FILL the canvas (Phase 4.1 P0-1)
 * rather than smear ~6 bars into the right edge. 900 is a bounded,
 * cheap ceiling (one `WSCellClosePayload` is five numbers) covering 30
 * bars at 30 levels with headroom. The CVD series ring stays bar-count.
 */
export const STREAM_CLOSED_CELLS_CAP = 900;

/**
 * CVD series ring size — one point per closed BAR (not per cell), so it
 * covers at least as many bars as the footprint can show on the widest
 * realistic viewport. A single bar can produce many `cell.close` frames
 * (one per price bucket) that all fold into one series point, so this
 * cap is bar-count, not cell-count. Matches `STREAM_CLOSED_CELLS_CAP`
 * for symmetry — the closed-cell ring is the upper bound on distinct
 * bars the client retains.
 */
export const STREAM_CVD_SERIES_CAP = 120;

/**
 * One point on the cumulative-volume-delta time series. `cvd` is the
 * RUNNING cumulative value at this bar's close (NOT the per-bar delta).
 * `bucketTs` is the bar's UTC-aligned 1-minute bucket timestamp — the
 * same X-axis key the footprint cells use, so the CVD pane aligns to
 * the chart without a second time model.
 */
export interface CvdPoint {
  bucketTs: number;
  cvd: number;
}

/** Recent-ticks ring size — matches the WS snapshot's tick pin. */
export const STREAM_RECENT_TICKS_CAP = 200;

/** Sliding-window length for the frames-per-sec rate. */
const FRAMES_WINDOW_MS = 5_000;

function openCellKey(bucketTs: number, priceBucket: number): string {
  return `${String(bucketTs)}:${String(priceBucket)}`;
}

/**
 * Worker availability, derived from the `control.worker_unavailable` /
 * `control.worker_ready` frames (ADR-004). This is a STREAM-domain signal,
 * not a connection signal: the WebSocket stays connected throughout a
 * worker restart (the tape strip keeps moving on the direct Binance
 * broadcast), only the footprint cell stream pauses. The status bar
 * surfaces a calm "Cells paused — worker restarting" indicator off this so
 * the user understands the footprint froze but the app is fine.
 *
 *   - `'available'`   — Worker is up (or has never reported otherwise).
 *                       The default; the footprint updates normally.
 *   - `'unavailable'` — Worker dropped (crash / SIGTERM / handshake
 *                       timeout). Cell deltas/closes have paused; ticks
 *                       keep flowing. Cleared back to `'available'` on the
 *                       next `control.worker_ready`.
 *
 * Default is `'available'` — absence of a control frame must NOT read as
 * "offline" (a fresh connect that never sees a worker_unavailable should
 * show nothing). The indicator only appears after an explicit
 * `worker_unavailable` and disappears on `worker_ready`.
 */
export type WorkerAvailability = 'available' | 'unavailable';

export interface StreamState {
  connectionState: WSConnectionState;
  lastTickTsMs: number | null;
  tickCount: number;
  framesPerSec: number;
  /**
   * Worker availability derived from the control frames (ADR-004).
   * `'unavailable'` means the footprint cell stream has paused while the
   * Rust aggregation worker restarts; ticks keep flowing.
   */
  workerAvailability: WorkerAvailability;
  /**
   * Server clock (ms since epoch) at which the worker went unavailable,
   * from `control.worker_unavailable.serverTsMs`. `null` while available.
   * Retained so a future indicator can show a "paused for Ns" duration;
   * cleared on `worker_ready`.
   */
  workerUnavailableSinceMs: number | null;
  /** Last N ticks for the future tape strip (Phase 3.3). Oldest at index 0. */
  recentTicks: WSTickPayload[];
  /** Open-bar cell map. Keyed by `${bucketTs}:${priceBucket}`. */
  openCells: Map<string, WSCellDeltaPayload>;
  /** Closed-cell ring. Oldest at index 0. */
  closedCells: WSCellClosePayload[];
  /**
   * Client-derived Cumulative Volume Delta (ADR-008). Running sum of
   * `askVolume − bidVolume` over every `cell.close` folded this
   * session, seeded from the snapshot's closed cells. NOT on the wire.
   */
  cvd: number;
  /**
   * Per-bar CVD time series (Task 3.2c). Oldest at index 0, newest at
   * the end. One point per closed bar, carrying the running cumulative
   * CVD at that bar's close. The CVD line sub-pane reads this; it is
   * NOT re-folded anywhere else. Bounded at `STREAM_CVD_SERIES_CAP`.
   */
  cvdSeries: CvdPoint[];
  /** Retained for the reconnect-from-snapshot path. */
  lastSnapshot: WSSnapshotPayload | null;

  ingestFrame: (frame: WSFrame) => void;
  ingestSnapshot: (snapshot: WSSnapshotPayload) => void;
  setConnectionState: (state: WSConnectionState) => void;
  resetSession: () => void;
}

/**
 * Mutable internal state held outside the Zustand store: the arrival
 * timestamps that drive `framesPerSec`. Keeping it off the store
 * avoids forcing a render on every frame; the store gets the derived
 * rate when the ingest function updates it.
 */
const arrivalTimestamps: number[] = [];

function pushArrival(now: number): number {
  arrivalTimestamps.push(now);
  const cutoff = now - FRAMES_WINDOW_MS;
  // Prune from the head — small frame counts at sub-1k fps make this
  // O(N) prune cheap; we never exceed a few hundred entries.
  let head = arrivalTimestamps[0];
  while (head !== undefined && head < cutoff) {
    arrivalTimestamps.shift();
    head = arrivalTimestamps[0];
  }
  return arrivalTimestamps.length / (FRAMES_WINDOW_MS / 1000);
}

function pushBoundedTicks(
  current: WSTickPayload[],
  next: WSTickPayload,
): WSTickPayload[] {
  const out =
    current.length < STREAM_RECENT_TICKS_CAP
      ? [...current, next]
      : [...current.slice(current.length - STREAM_RECENT_TICKS_CAP + 1), next];
  return out;
}

function pushBoundedClosed(
  current: WSCellClosePayload[],
  next: WSCellClosePayload,
): WSCellClosePayload[] {
  const out =
    current.length < STREAM_CLOSED_CELLS_CAP
      ? [...current, next]
      : [
          ...current.slice(current.length - STREAM_CLOSED_CELLS_CAP + 1),
          next,
        ];
  return out;
}

/**
 * Net volume delta for one closed cell: ask-aggressed (buys lifting
 * offers) minus bid-aggressed (sells hitting bids). Positive = net
 * buying. This is the per-cell contribution to the running CVD.
 */
function cellCloseDelta(cell: WSCellClosePayload): number {
  return cell.askVolume - cell.bidVolume;
}

/**
 * Project one cell of a `replay.bar` frame into the `cell.close` shape
 * the rest of the store reducers consume. The replay-bar cell drops the
 * per-cell `symbol` (it lives once on the frame) and the read-time
 * `delta` projection (the store re-derives delta from totals where it
 * needs it). Carrying the bar's `symbol` + `bucketTs` onto each cell
 * lets a replayed bar flow through the IDENTICAL closed-cell ring + CVD
 * fold that live `cell.close` frames use — no second code path. The
 * replay engine emits replay bars in forward `bucketTs` order, so the
 * `pushCvdSeries` append/replace logic behaves exactly as it does live.
 */
function replayBarCellToClose(
  payload: WSReplayBarPayload,
  cell: WSReplayBarPayload['cells'][number],
): WSCellClosePayload {
  return {
    symbol: payload.symbol,
    bucketTs: payload.bucketTs,
    priceBucket: cell.priceBucket,
    bidVolume: cell.bidVolume,
    askVolume: cell.askVolume,
    trades: cell.trades,
  };
}

/**
 * Fold one closed cell into the per-bar CVD series, returning the next
 * (bounded) series. Pure — no mutation of `current`.
 *
 * Rules:
 *   - The new running CVD (`runningCvd`) is the cumulative value AFTER
 *     this cell.close has been added to the scalar accumulator.
 *   - If the trailing point already covers `bucketTs`, we replace its
 *     `cvd` with `runningCvd` (the bar is still accumulating its
 *     per-price-bucket closes within the same minute — they share one
 *     series point).
 *   - If `bucketTs` is newer than the trailing point (or the series is
 *     empty), we append a fresh point.
 *   - An out-of-order older `bucketTs` (should not happen in a forward
 *     live stream, but possible across a reconnect race) updates the
 *     matching existing point if present, else appends — the line stays
 *     monotonic in render order because we sort-free trust the wire's
 *     forward ordering and only special-case the trailing bar.
 *
 * The ring trims from the head, never affecting the scalar `cvd`
 * accumulator (which is unbounded by design — see `cellCloseDelta`).
 */
function pushCvdSeries(
  current: CvdPoint[],
  bucketTs: number,
  runningCvd: number,
): CvdPoint[] {
  const last = current[current.length - 1];
  if (last?.bucketTs === bucketTs) {
    // Same bar — replace the trailing point's running value.
    const next = current.slice(0, current.length - 1);
    next.push({ bucketTs, cvd: runningCvd });
    return next;
  }
  if (last === undefined || bucketTs > last.bucketTs) {
    // New (forward) bar — append, trimming the head if over cap.
    const appended =
      current.length < STREAM_CVD_SERIES_CAP
        ? [...current, { bucketTs, cvd: runningCvd }]
        : [
            ...current.slice(current.length - STREAM_CVD_SERIES_CAP + 1),
            { bucketTs, cvd: runningCvd },
          ];
    return appended;
  }
  // Out-of-order older bucket — update in place if present.
  const idx = current.findIndex((p) => p.bucketTs === bucketTs);
  if (idx === -1) {
    return [...current, { bucketTs, cvd: runningCvd }];
  }
  const next = current.slice();
  next[idx] = { bucketTs, cvd: runningCvd };
  return next;
}

/**
 * Build the full per-bar CVD series from a snapshot's closed-cell list.
 * Closed cells arrive grouped by bar (the server emits them
 * bar-by-bar); we fold the running CVD and emit one point per distinct
 * `bucketTs`, in first-seen order. Bounded at the tail to
 * `STREAM_CVD_SERIES_CAP` so the seeded series matches the live-ring
 * cap.
 */
function seedCvdSeries(cells: WSCellClosePayload[]): CvdPoint[] {
  const series: CvdPoint[] = [];
  let running = 0;
  for (const cell of cells) {
    running += cellCloseDelta(cell);
    const last = series[series.length - 1];
    if (last?.bucketTs === cell.bucketTs) {
      last.cvd = running;
    } else {
      series.push({ bucketTs: cell.bucketTs, cvd: running });
    }
  }
  return series.slice(-STREAM_CVD_SERIES_CAP);
}

function seedFromSnapshot(
  snapshot: WSSnapshotPayload,
): {
  recentTicks: WSTickPayload[];
  openCells: Map<string, WSCellDeltaPayload>;
  closedCells: WSCellClosePayload[];
  cvd: number;
  cvdSeries: CvdPoint[];
} {
  const recentTicks = snapshot.recentTicks.slice(-STREAM_RECENT_TICKS_CAP);
  const closedCells = snapshot.cells.slice(-STREAM_CLOSED_CELLS_CAP);
  const openCells = new Map<string, WSCellDeltaPayload>();
  for (const delta of snapshot.cellsOpen) {
    openCells.set(openCellKey(delta.bucketTs, delta.priceBucket), delta);
  }
  // Seed CVD from the snapshot's full closed-cell history (not the
  // ring-trimmed subset) so the running value reflects every closed
  // cell the server included, even when the ring caps the rendered
  // count. ADR-008: the client CVD is a fresh fold per snapshot.
  let cvd = 0;
  for (const cell of snapshot.cells) {
    cvd += cellCloseDelta(cell);
  }
  // The per-bar series is folded from the SAME full history; its tail
  // is ring-trimmed to the series cap (the scalar above is not).
  const cvdSeries = seedCvdSeries(snapshot.cells);
  return { recentTicks, openCells, closedCells, cvd, cvdSeries };
}

export const useStreamStore = create<StreamState>()((set) => ({
  connectionState: 'idle',
  lastTickTsMs: null,
  tickCount: 0,
  framesPerSec: 0,
  workerAvailability: 'available',
  workerUnavailableSinceMs: null,
  recentTicks: [],
  openCells: new Map(),
  closedCells: [],
  cvd: 0,
  cvdSeries: [],
  lastSnapshot: null,

  ingestFrame: (frame) => {
    const now = Date.now();
    const framesPerSec = pushArrival(now);

    switch (frame.kind) {
      case 'tick': {
        set((state) => ({
          tickCount: state.tickCount + 1,
          lastTickTsMs: frame.payload.tsMs,
          recentTicks: pushBoundedTicks(state.recentTicks, frame.payload),
          framesPerSec,
        }));
        return;
      }
      case 'cell.delta': {
        const key = openCellKey(
          frame.payload.bucketTs,
          frame.payload.priceBucket,
        );
        set((state) => {
          const next = new Map(state.openCells);
          const prev = next.get(key);
          next.set(
            key,
            prev === undefined
              ? frame.payload
              : {
                  tsMs: frame.payload.tsMs,
                  bucketTs: frame.payload.bucketTs,
                  priceBucket: frame.payload.priceBucket,
                  bidVolumeDelta:
                    prev.bidVolumeDelta + frame.payload.bidVolumeDelta,
                  askVolumeDelta:
                    prev.askVolumeDelta + frame.payload.askVolumeDelta,
                  tradesDelta: prev.tradesDelta + frame.payload.tradesDelta,
                },
          );
          return { openCells: next, framesPerSec };
        });
        return;
      }
      case 'cell.close': {
        const key = openCellKey(
          frame.payload.bucketTs,
          frame.payload.priceBucket,
        );
        set((state) => {
          const nextOpen = new Map(state.openCells);
          nextOpen.delete(key);
          // Fold this closed cell into the running CVD (ADR-008).
          // Additive over the cell stream; the ring trim only bounds
          // the RENDERED history, never the CVD accumulator.
          const nextCvd = state.cvd + cellCloseDelta(frame.payload);
          return {
            openCells: nextOpen,
            closedCells: pushBoundedClosed(state.closedCells, frame.payload),
            cvd: nextCvd,
            // Mirror the running CVD into the per-bar series (Task
            // 3.2c). Same bar updates its trailing point; a new bar
            // appends. This is the seam the CVD line pane consumes.
            cvdSeries: pushCvdSeries(
              state.cvdSeries,
              frame.payload.bucketTs,
              nextCvd,
            ),
            framesPerSec,
          };
        });
        return;
      }
      case 'replay.bar': {
        // Replay mode (Task 3.6). One frame carries a whole closed bar's
        // absolute cell totals; the virtual clock has just crossed this
        // bar's boundary. Fold each cell exactly like a `cell.close`:
        // push into the closed-cell ring + accumulate the running CVD +
        // mirror it into the per-bar CVD series (Task 3.2c seam). No
        // delta accumulation — replay bars are already closed. Done in a
        // single set() so the chart rebases the whole bar atomically.
        const payload = frame.payload;
        set((state) => {
          let closed = state.closedCells;
          let cvd = state.cvd;
          let cvdSeries = state.cvdSeries;
          const nextOpen = new Map(state.openCells);
          for (const cell of payload.cells) {
            const closeCell = replayBarCellToClose(payload, cell);
            // A replayed bar supersedes any open-cell state at the same
            // key (e.g. left over from a seek that materialised the bar
            // as it was still open) — evict before pushing the close.
            nextOpen.delete(
              openCellKey(closeCell.bucketTs, closeCell.priceBucket),
            );
            closed = pushBoundedClosed(closed, closeCell);
            cvd += cellCloseDelta(closeCell);
            cvdSeries = pushCvdSeries(cvdSeries, payload.bucketTs, cvd);
          }
          return {
            openCells: nextOpen,
            closedCells: closed,
            cvd,
            cvdSeries,
            framesPerSec,
          };
        });
        return;
      }
      case 'control.worker_unavailable': {
        // The Rust aggregation worker dropped (crash / SIGTERM / handshake
        // timeout, ADR-004). Footprint cell deltas/closes have paused;
        // ticks keep flowing on the direct Binance broadcast. Flip the
        // store's worker-availability so the status bar surfaces a calm
        // "Cells paused — worker restarting" indicator. `serverTsMs` is
        // the "went offline at" marker the indicator can show a duration
        // from.
        set({
          workerAvailability: 'unavailable',
          workerUnavailableSinceMs: frame.payload.serverTsMs,
          framesPerSec,
        });
        return;
      }
      case 'control.worker_ready': {
        // Worker completed its bridge handshake and is producing cells
        // again (ADR-004). Clear the paused state so the indicator
        // disappears. Idempotent — a `worker_ready` with no preceding
        // `worker_unavailable` (fresh boot, or a duplicate) just confirms
        // the default available state.
        set({
          workerAvailability: 'available',
          workerUnavailableSinceMs: null,
          framesPerSec,
        });
        return;
      }
      case 'control.heartbeat':
      case 'control.overrun': {
        // Other control frames are observed but do not mutate domain state
        // in v1. The provider may surface them via separate side channels
        // (toast, banner) — schema validation has already happened. They
        // fall through to the same observe-only path and keep the
        // discriminated-union switch exhaustive.
        set({ framesPerSec });
        return;
      }
      case 'snapshot': {
        // Defensive: in the canonical flow the client routes snapshots
        // to `ingestSnapshot` directly, so `ingestFrame` never sees a
        // snapshot. If a future caller wires the same envelope into a
        // single sink, do the right thing instead of throwing.
        useStreamStore.getState().ingestSnapshot(frame.payload);
        set({ framesPerSec });
        return;
      }
      default: {
        // Discriminated union is exhaustive — TS will catch missed
        // kinds at compile time.
        const _exhaustive: never = frame;
        void _exhaustive;
      }
    }
  },

  ingestSnapshot: (snapshot) => {
    const seeded = seedFromSnapshot(snapshot);
    const newestTick = seeded.recentTicks.at(-1);
    set({
      lastSnapshot: snapshot,
      tickCount: 0,
      lastTickTsMs: newestTick === undefined ? null : newestTick.tsMs,
      recentTicks: seeded.recentTicks,
      openCells: seeded.openCells,
      closedCells: seeded.closedCells,
      cvd: seeded.cvd,
      cvdSeries: seeded.cvdSeries,
    });
  },

  setConnectionState: (connectionState) => {
    set({ connectionState });
  },

  resetSession: () => {
    arrivalTimestamps.length = 0;
    set({
      connectionState: 'idle',
      lastTickTsMs: null,
      tickCount: 0,
      framesPerSec: 0,
      // A reconnect/fresh session resets worker availability to the
      // default — the next snapshot is the authoritative baseline and a
      // stale "unavailable" must not persist across a reconnect.
      workerAvailability: 'available',
      workerUnavailableSinceMs: null,
      recentTicks: [],
      openCells: new Map(),
      closedCells: [],
      cvd: 0,
      cvdSeries: [],
      lastSnapshot: null,
    });
  },
}));

/* -------------------------------------------------------------------------
 * Dev-only escape hatch. Exposes the vanilla store on `window` so a
 * headless-Chrome / CDP capture can seed a deterministic footprint
 * snapshot without standing up the full Binance → worker → WS pipeline.
 * Gated on `process.env.NODE_ENV === 'development'` so Next inlines the
 * branch to `false` in production builds and the whole block is
 * dead-code-eliminated — it never ships.
 * --------------------------------------------------------------------- */
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  (window as unknown as { __tapeStore?: typeof useStreamStore }).__tapeStore =
    useStreamStore;
}

/* -------------------------------------------------------------------------
 * Selector helpers — thin wrappers so consumers do not import the whole
 * store shape. Each picks the right equality function for its return
 * shape (default `Object.is` for primitives; shallow for arrays / maps).
 * --------------------------------------------------------------------- */

export function useConnectionState(): WSConnectionState {
  return useStreamStore((state) => state.connectionState);
}

export function useLastTick(): number | null {
  return useStreamStore((state) => state.lastTickTsMs);
}

export function useTickCount(): number {
  return useStreamStore((state) => state.tickCount);
}

export function useFramesPerSec(): number {
  return useStreamStore((state) => state.framesPerSec);
}

/**
 * Worker availability (ADR-004). `'unavailable'` while the Rust
 * aggregation worker is restarting — the footprint cell stream has paused
 * but ticks keep flowing. The status bar's "Cells paused" indicator
 * consumes this. Default `'available'`.
 */
export function useWorkerAvailability(): WorkerAvailability {
  return useStreamStore((state) => state.workerAvailability);
}

export function useRecentTicks(n?: number): WSTickPayload[] {
  return useStreamStore(
    useShallow((state) =>
      n === undefined ? state.recentTicks : state.recentTicks.slice(-n),
    ),
  );
}

export function useClosedCells(): WSCellClosePayload[] {
  return useStreamStore(useShallow((state) => state.closedCells));
}

/**
 * Client-derived CVD (ADR-008). The seam Task 3.2c (CVD line sub-pane)
 * consumes — it reads this running value rather than re-folding the
 * cell stream itself.
 */
export function useCvd(): number {
  return useStreamStore((state) => state.cvd);
}

/**
 * Client-derived per-bar CVD series (Task 3.2c). The CVD line sub-pane
 * consumes this; it is the single derivation site — consumers never
 * re-fold the cell stream. `useShallow` because the return is an array
 * (the ring reference changes on each fold, but identical contents
 * across no-op renders are deduped by shallow element comparison).
 */
export function useCvdSeries(): CvdPoint[] {
  return useStreamStore(useShallow((state) => state.cvdSeries));
}

export function useOpenCells(): Map<string, WSCellDeltaPayload> {
  // The Map identity is preserved across set() calls only when a delta
  // does not arrive — once we clone-on-write the reference changes.
  // Default Object.is is correct here because the Map ref tracks
  // mutation. No `shallow` for a Map.
  return useStreamStore((state) => state.openCells);
}

// Suppress unused-import lint warning — `shallow` is exported for
// downstream consumers that want to write their own selectors with
// `useStreamStore(selector, shallow)` and reach for the same equality
// shape this module uses internally.
export { shallow };
