import { create } from 'zustand';

/**
 * Connection-state store (Zustand) — LOW-frequency UI chrome state only.
 *
 * This holds the WebSocket lifecycle status the connection pill (and any
 * "reconnecting" banner) renders. It is updated a handful of times over a
 * session (connect / drop / reconnect), NOT per telemetry frame — the per-frame
 * telemetry lives in the off-render-path InterpStore (the "streaming surface is
 * not React state" gate). Keeping the two stores separate is the discipline.
 */

export type ConnectionStatus =
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline';

interface ConnectionState {
  status: ConnectionStatus;
  /** Server tick index of the most recent frame — a discreet liveness readout. */
  serverTick: number | null;
  setStatus: (status: ConnectionStatus) => void;
  setServerTick: (tick: number) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'connecting',
  serverTick: null,
  setStatus: (status) => {
    set({ status });
  },
  setServerTick: (serverTick) => {
    set({ serverTick });
  },
}));
