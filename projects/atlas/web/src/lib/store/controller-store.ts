import { create } from 'zustand';

import type { AtlasMapController } from '@/lib/map/map-controller';

/**
 * Map-controller bridge store.
 *
 * The fleet panel + the detail panel live OUTSIDE the map canvas in the layout
 * tree, but clicking a fleet row must drive the imperative map (camera fly-to).
 * The MapCanvas publishes its controller here on mount and clears it on unmount;
 * the panels read it to call `focusVehicleAt(...)`. This keeps the controller
 * off the render path (it is a plain class held by reference, not React state
 * that re-renders) while letting sibling panels reach it.
 *
 * When the map is absent (no-WebGL fallback, Phase 6), `controller` stays null
 * and the fleet table still selects/pins vehicles — it simply does not fly a
 * camera that is not there. The fleet panel therefore stays fully functional as
 * the non-map alternative.
 */

interface ControllerState {
  controller: AtlasMapController | null;
  setController: (controller: AtlasMapController | null) => void;
}

export const useControllerStore = create<ControllerState>((set) => ({
  controller: null,
  setController: (controller) => {
    set({ controller });
  },
}));
