import { create } from 'zustand';

import type { SimControlFrame } from 'atlas-shared/schemas/ws';

/**
 * Sim-control bridge store (Task 5.4).
 *
 * The demo affordance (a React component) needs to speak the `sim.control`
 * client frame over the ONE existing WebSocket — it must NOT open a second
 * socket. The live-telemetry hook owns the socket; it publishes a `send`
 * function here on connect and clears it on teardown, plus the live playback
 * state (paused / speed multiplier) it tracks so the controls reflect reality.
 *
 * `send` is null until the socket is live, so the demo UI disables its controls
 * until the channel is up (honest — no queueing a control into the void).
 */

interface SimControlState {
  /** Send a sim.control frame over the live socket, or null if not connected. */
  send: ((frame: SimControlFrame) => void) | null;
  paused: boolean;
  /** Demo speed multiplier the shell is running at (ticks per real second). */
  speed: number;
  setSend: (send: ((frame: SimControlFrame) => void) | null) => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: number) => void;
}

export const useSimControlStore = create<SimControlState>((set) => ({
  send: null,
  paused: false,
  speed: 1,
  setSend: (send) => {
    set({ send });
  },
  setPaused: (paused) => {
    set({ paused });
  },
  setSpeed: (speed) => {
    set({ speed });
  },
}));
