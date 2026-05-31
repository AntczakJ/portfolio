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
 */
import { create } from 'zustand';
import { shallow } from 'zustand/shallow';
import { useShallow } from 'zustand/react/shallow';
import type {
  WSCellClosePayload,
  WSCellDeltaPayload,
  WSFrame,
  WSSnapshotPayload,
  WSTickPayload,
} from 'tape-server';

import type { WSConnectionState } from '@/lib/ws/client';

/** Closed-cell ring size — matches the WS snapshot's closed-cell pin. */
export const STREAM_CLOSED_CELLS_CAP = 120;

/** Recent-ticks ring size — matches the WS snapshot's tick pin. */
export const STREAM_RECENT_TICKS_CAP = 200;

/** Sliding-window length for the frames-per-sec rate. */
const FRAMES_WINDOW_MS = 5_000;

function openCellKey(bucketTs: number, priceBucket: number): string {
  return `${bucketTs}:${priceBucket}`;
}

export interface StreamState {
  connectionState: WSConnectionState;
  lastTickTsMs: number | null;
  tickCount: number;
  framesPerSec: number;
  /** Last N ticks for the future tape strip (Phase 3.3). Oldest at index 0. */
  recentTicks: WSTickPayload[];
  /** Open-bar cell map. Keyed by `${bucketTs}:${priceBucket}`. */
  openCells: Map<string, WSCellDeltaPayload>;
  /** Closed-cell ring. Oldest at index 0. */
  closedCells: WSCellClosePayload[];
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
  while (arrivalTimestamps.length > 0 && arrivalTimestamps[0]! < cutoff) {
    arrivalTimestamps.shift();
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

function seedFromSnapshot(
  snapshot: WSSnapshotPayload,
): {
  recentTicks: WSTickPayload[];
  openCells: Map<string, WSCellDeltaPayload>;
  closedCells: WSCellClosePayload[];
} {
  const recentTicks = snapshot.recentTicks.slice(-STREAM_RECENT_TICKS_CAP);
  const closedCells = snapshot.cells.slice(-STREAM_CLOSED_CELLS_CAP);
  const openCells = new Map<string, WSCellDeltaPayload>();
  for (const delta of snapshot.cellsOpen) {
    openCells.set(openCellKey(delta.bucketTs, delta.priceBucket), delta);
  }
  return { recentTicks, openCells, closedCells };
}

export const useStreamStore = create<StreamState>()((set) => ({
  connectionState: 'idle',
  lastTickTsMs: null,
  tickCount: 0,
  framesPerSec: 0,
  recentTicks: [],
  openCells: new Map(),
  closedCells: [],
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
          return {
            openCells: nextOpen,
            closedCells: pushBoundedClosed(state.closedCells, frame.payload),
            framesPerSec,
          };
        });
        return;
      }
      case 'control.heartbeat':
      case 'control.overrun': {
        // Control frames are observed but do not mutate domain state in
        // v1. The provider may surface them via separate side channels
        // (toast, banner) — schema validation has already happened.
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
    set({
      lastSnapshot: snapshot,
      tickCount: 0,
      lastTickTsMs:
        seeded.recentTicks.length > 0
          ? seeded.recentTicks[seeded.recentTicks.length - 1]!.tsMs
          : null,
      recentTicks: seeded.recentTicks,
      openCells: seeded.openCells,
      closedCells: seeded.closedCells,
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
      recentTicks: [],
      openCells: new Map(),
      closedCells: [],
      lastSnapshot: null,
    });
  },
}));

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
