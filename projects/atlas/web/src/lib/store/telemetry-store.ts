import { create } from 'zustand';

import type {
  Route as SharedRoute,
  RouteStop as SharedStop,
  Vehicle as SharedVehicle,
  VehicleTelemetry,
  Zone as SharedZone,
} from 'atlas-shared/schemas';

/**
 * Low-frequency telemetry store (Task 5.x data layer).
 *
 * This is the React-state side of the live stream — deliberately SEPARATE from
 * the off-render-path InterpStore + the rAF loop (the hard gate: the panels must
 * NOT subscribe to the rAF interpolation loop). It is fed from the SAME single
 * WebSocket socket via the existing `use-live-telemetry.ts` callbacks: `onSnapshot`
 * seeds the static world definitions + the first telemetry, `onTick` replaces the
 * per-vehicle telemetry at 1 Hz. 1 Hz is fine for React — the panels re-render
 * once a second, not once a frame.
 *
 * It holds:
 *   - the static world DEFINITIONS (vehicle identity, routes + nested stops,
 *     zones) so a panel can resolve a vehicle's label / route name / zone name
 *     without a second source;
 *   - the latest per-vehicle TELEMETRY (position, heading, speed, progress, ETA,
 *     status, currentZoneId) keyed by vehicle id.
 *
 * Telemetry is stored as a plain record (replaced wholesale per tick, never
 * mutated in place) so selectors are stable and a subscribing panel re-renders
 * only when the value it reads changes.
 */

export interface VehicleDefinition {
  id: string;
  label: string;
  type: SharedVehicle['type'];
  routeId: string;
}

export interface RouteDefinition {
  id: string;
  name: string;
  loopMode: SharedRoute['loopMode'];
  lengthM: number;
  stops: StopDefinition[];
}

export interface StopDefinition {
  id: string;
  seq: number;
  name: string;
  dwellSeconds: number;
}

export interface ZoneDefinition {
  id: string;
  name: string;
  kind: SharedZone['kind'];
}

interface TelemetryState {
  /** True once the first snapshot has seeded the world. */
  hydrated: boolean;
  /** Vehicle id -> static identity. */
  vehicles: Record<string, VehicleDefinition>;
  /** Stable display order (snapshot order, by label). */
  vehicleIds: string[];
  /** Route id -> definition (name, loop mode, ordered stops). */
  routes: Record<string, RouteDefinition>;
  /** Zone id -> definition (name, kind). */
  zones: Record<string, ZoneDefinition>;
  /** Vehicle id -> latest authoritative telemetry. */
  telemetry: Record<string, VehicleTelemetry>;
  /** Seed the static world + the first telemetry from a snapshot frame. */
  applySnapshot: (input: SnapshotInput) => void;
  /** Replace the telemetry for the vehicles in a tick frame (newest wins). */
  applyTick: (telemetry: readonly VehicleTelemetry[]) => void;
}

export interface SnapshotInput {
  vehicles: readonly SharedVehicle[];
  routes: readonly SharedRoute[];
  stops: readonly SharedStop[];
  zones: readonly SharedZone[];
  telemetry: readonly VehicleTelemetry[];
}

function buildRoutes(
  routes: readonly SharedRoute[],
  stops: readonly SharedStop[],
): Record<string, RouteDefinition> {
  const byId: Record<string, RouteDefinition> = {};
  for (const route of routes) {
    const routeStops = stops
      .filter((s) => s.routeId === route.id)
      .sort((a, b) => a.seq - b.seq)
      .map<StopDefinition>((s) => ({
        id: s.id,
        seq: s.seq,
        name: s.name,
        dwellSeconds: s.dwellSeconds,
      }));
    byId[route.id] = {
      id: route.id,
      name: route.name,
      loopMode: route.loopMode,
      lengthM: route.lengthM,
      stops: routeStops,
    };
  }
  return byId;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  hydrated: false,
  vehicles: {},
  vehicleIds: [],
  routes: {},
  zones: {},
  telemetry: {},

  applySnapshot: ({ vehicles, routes, stops, zones, telemetry }) => {
    const vehicleMap: Record<string, VehicleDefinition> = {};
    for (const v of vehicles) {
      vehicleMap[v.id] = {
        id: v.id,
        label: v.label,
        type: v.type,
        routeId: v.routeId,
      };
    }
    // Stable display order: by label, natural-ish (numeric-aware) so "Unit 2"
    // precedes "Unit 10".
    const vehicleIds = Object.values(vehicleMap)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
      .map((v) => v.id);

    const zoneMap: Record<string, ZoneDefinition> = {};
    for (const z of zones) {
      zoneMap[z.id] = { id: z.id, name: z.name, kind: z.kind };
    }

    const telemetryMap: Record<string, VehicleTelemetry> = {};
    for (const t of telemetry) telemetryMap[t.vehicleId] = t;

    set({
      hydrated: true,
      vehicles: vehicleMap,
      vehicleIds,
      routes: buildRoutes(routes, stops),
      zones: zoneMap,
      telemetry: telemetryMap,
    });
  },

  applyTick: (telemetry) => {
    if (telemetry.length === 0) return;
    set((state) => {
      // Replace (never mutate) only the vehicles in this tick — a slow consumer
      // already received coalesce-to-latest from the gateway, so the newest tick
      // is authoritative. Unchanged vehicles keep their reference (no spurious
      // re-render of rows that did not change).
      const next = { ...state.telemetry };
      for (const t of telemetry) next[t.vehicleId] = t;
      return { telemetry: next };
    });
  },
}));
