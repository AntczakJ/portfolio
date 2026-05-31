'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Replay speed multipliers offered by the replay control bar (Task 2.4).
 *
 * Kept as a const tuple so the TS literal union flows naturally to the
 * `ToggleGroup` items and the store action signature. New multipliers
 * (e.g., 10x) would land here first.
 */
export const REPLAY_SPEEDS = [1, 5, 30] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Upper bound of the scrub slider — 24 hours of UTC session time. */
export const REPLAY_DAY_MS = 86_400_000;

/**
 * Persistent UI shell state.
 *
 * Lives outside React state because the value must survive a full page
 * reload — collapsing the rail and then refreshing should not snap it
 * back open. Persistence key `tape-ui-v1` is versioned so a future
 * incompatible state shape can migrate cleanly via a `tape-ui-v2`
 * rename without colliding with older payloads in browsers.
 *
 * Scope: chrome only. Domain state (trade stream, footprint cells,
 * replay clock) lives in separate stores wired in Phase 3. The replay
 * fields below are intent surfaces — the actual replay engine (clock
 * advancement, frame fan-out) lands with the WebSocket wiring in
 * Phase 1.6 / 1.7 and Phase 3.6.
 */
export interface UiState {
  /** Side rail expanded (false) or collapsed to icon-only (true). */
  railCollapsed: boolean;
  /** Toggle the rail collapsed state. */
  toggleRail: () => void;
  /** Imperative setter for responsive auto-collapse on viewport change. */
  setRailCollapsed: (value: boolean) => void;

  /**
   * Replay mode toggle. In `'live'` the chart streams the live WS feed
   * and the replay control bar collapses to a thin pill. In `'replay'`
   * the bar expands and the chart reads from the virtual clock driven
   * by `replayPositionMs`.
   */
  replayMode: 'live' | 'replay';
  setReplayMode: (mode: UiState['replayMode']) => void;

  /** Replay clock multiplier — 1x, 5x, or 30x. */
  replaySpeedX: ReplaySpeed;
  setReplaySpeed: (x: ReplaySpeed) => void;

  /**
   * Replay scrub position in milliseconds from 00:00 UTC of the session
   * day. Range `[0, REPLAY_DAY_MS]`. Treated as "session day 1" until
   * multi-day replay lands in v2.
   */
  replayPositionMs: number;
  setReplayPositionMs: (ms: number) => void;
}

function clampPosition(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  if (ms < 0) return 0;
  if (ms > REPLAY_DAY_MS) return REPLAY_DAY_MS;
  return ms;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      toggleRail: () => {
        set((state) => ({ railCollapsed: !state.railCollapsed }));
      },
      setRailCollapsed: (value) => {
        set({ railCollapsed: value });
      },

      replayMode: 'live',
      setReplayMode: (mode) => {
        set({ replayMode: mode });
      },

      replaySpeedX: 1,
      setReplaySpeed: (x) => {
        set({ replaySpeedX: x });
      },

      replayPositionMs: 0,
      setReplayPositionMs: (ms) => {
        set({ replayPositionMs: clampPosition(ms) });
      },
    }),
    {
      name: 'tape-ui-v1',
      storage: createJSONStorage(() => localStorage),
      // Persist UI intent fields. Action references and any future
      // transient state stay out of localStorage. Existing v1 payloads
      // (railCollapsed only) decode cleanly because Zustand merges
      // persisted fields over the default state.
      partialize: (state) => ({
        railCollapsed: state.railCollapsed,
        replayMode: state.replayMode,
        replaySpeedX: state.replaySpeedX,
        replayPositionMs: state.replayPositionMs,
      }),
    },
  ),
);
