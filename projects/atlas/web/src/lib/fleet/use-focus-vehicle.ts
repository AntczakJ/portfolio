'use client';

import { useCallback } from 'react';

import { useControllerStore } from '@/lib/store/controller-store';
import { useOpsStore } from '@/lib/store/ops-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';

/**
 * useFocusVehicle — the shared selection + camera-focus action (Task 5.1).
 *
 * Clicking/Enter on a fleet row (or a detail action) does three things, in one
 * place so the keyboard path and the map path agree:
 *   1. selects the vehicle in the ops store (pins the detail panel, highlights
 *      the row),
 *   2. flies the camera to the vehicle's CURRENT live position — read from the
 *      1 Hz telemetry store (fresher than the controller's last snapshot), via
 *      the controller's `focusVehicleAt`. Under reduced motion the controller
 *      cuts instead of flying (its own flag).
 *
 * When there is no map (no-WebGL fallback, Phase 6) the controller is null and
 * step 2 is simply skipped — selection still works, so the fleet table stays
 * fully functional as the non-map alternative.
 */
export function useFocusVehicle(): (vehicleId: string) => void {
  const selectVehicle = useOpsStore((s) => s.selectVehicle);

  return useCallback(
    (vehicleId: string) => {
      selectVehicle(vehicleId);
      const controller = useControllerStore.getState().controller;
      if (!controller) return;
      const telemetry = useTelemetryStore.getState().telemetry[vehicleId];
      if (telemetry) {
        controller.focusVehicleAt([telemetry.lng, telemetry.lat]);
      } else {
        controller.focusVehicle(vehicleId);
      }
    },
    [selectVehicle],
  );
}
