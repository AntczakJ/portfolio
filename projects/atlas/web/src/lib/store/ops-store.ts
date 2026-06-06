import { create } from 'zustand';

/**
 * Client UI store (Zustand) — control-room view state.
 *
 * This holds CLIENT UI state only (which vehicle is selected, panel open state).
 * It is deliberately NOT where live telemetry lands: the Phase 4 WS telemetry
 * feeds an OFF-render-path ref store consumed by the rAF interpolation loop, not
 * React state (the "streaming surface is not React state" gate). Keeping the two
 * separate is the discipline — selection is low-frequency UI state (fine in
 * Zustand/React); per-frame positions are not.
 */
interface OpsState {
  selectedVehicleId: string | null;
  selectVehicle: (id: string | null) => void;
}

export const useOpsStore = create<OpsState>((set) => ({
  selectedVehicleId: null,
  selectVehicle: (id) => {
    set({ selectedVehicleId: id });
  },
}));
