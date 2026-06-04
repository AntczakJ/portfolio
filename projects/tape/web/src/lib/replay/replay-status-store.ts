'use client';

/**
 * Transient replay status + command store (Task 3.6).
 *
 * Separate from `useUiStore` (persisted chrome intent: mode, speed,
 * position, date) and `useStreamStore` (domain stream state). This holds
 * the EPHEMERAL replay-engine status — load state + playing flag — that
 * the replay bar and the empty-state overlay read, plus a tiny command
 * channel so the bar's play / pause / stop buttons reach the engine
 * (which the bar has no direct handle to). Commands are a monotonically
 * bumped nonce so the provider's subscription fires even when the same
 * command repeats.
 *
 * Not persisted: a reload re-enters replay from the persisted
 * `useUiStore` intent and the engine re-derives these.
 */
import { create } from 'zustand';

import type { ReplayLoadState } from './engine';

export type ReplayCommandType = 'play' | 'pause' | 'stop';

export interface ReplayCommand {
  type: ReplayCommandType;
  nonce: number;
}

export interface ReplayStatusState {
  loadState: ReplayLoadState;
  playing: boolean;
  command: ReplayCommand | null;
  setLoadState: (state: ReplayLoadState) => void;
  setPlaying: (playing: boolean) => void;
  /** Bar → engine command channel. Bumps the nonce so repeats fire. */
  dispatch: (type: ReplayCommandType) => void;
  reset: () => void;
}

export const useReplayStatusStore = create<ReplayStatusState>()((set) => ({
  loadState: 'idle',
  playing: false,
  command: null,
  setLoadState: (loadState) => {
    set({ loadState });
  },
  setPlaying: (playing) => {
    set({ playing });
  },
  dispatch: (type) => {
    set((state) => ({
      command: { type, nonce: (state.command?.nonce ?? 0) + 1 },
    }));
  },
  reset: () => {
    set({ loadState: 'idle', playing: false, command: null });
  },
}));

export function useReplayLoadState(): ReplayLoadState {
  return useReplayStatusStore((s) => s.loadState);
}

export function useReplayPlaying(): boolean {
  return useReplayStatusStore((s) => s.playing);
}
