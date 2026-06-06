import { beforeEach, describe, expect, it } from 'vitest';

import type {
  Route as SharedRoute,
  RouteStop as SharedStop,
  Vehicle as SharedVehicle,
  VehicleTelemetry,
  Zone as SharedZone,
} from 'atlas-shared/schemas';

import { useTelemetryStore } from '@/lib/store/telemetry-store';

function vehicle(id: string, label: string, routeId = 'route-1'): SharedVehicle {
  return { id, label, type: 'van', routeId, baseSpeedMps: 10, status: 'en_route' };
}

function telemetry(vehicleId: string, overrides: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    vehicleId,
    lat: 41.15,
    lng: -8.61,
    headingDeg: 90,
    speedMps: 10,
    routeId: 'route-1',
    distanceAlongRouteM: 100,
    progress: 0.4,
    status: 'en_route',
    nextStopId: 'stop-1',
    etaSeconds: 120,
    currentZoneId: null,
    ...overrides,
  };
}

const route: SharedRoute = {
  id: 'route-1',
  name: 'Aliados Loop',
  geometry: { type: 'LineString', coordinates: [[-8.61, 41.15], [-8.60, 41.16]] },
  lengthM: 1200,
  loopMode: 'loop',
};

const stops: SharedStop[] = [
  { id: 'stop-2', routeId: 'route-1', seq: 1, name: 'Delivery', point: { type: 'Point', coordinates: [-8.60, 41.16] }, dwellSeconds: 45 },
  { id: 'stop-1', routeId: 'route-1', seq: 0, name: 'Pickup', point: { type: 'Point', coordinates: [-8.61, 41.15] }, dwellSeconds: 30 },
];

const zones: SharedZone[] = [
  { id: 'zone-1', name: 'Aliados Delivery', kind: 'delivery_zone', geometry: { type: 'Polygon', coordinates: [[[-8.62, 41.14], [-8.59, 41.14], [-8.59, 41.17], [-8.62, 41.17], [-8.62, 41.14]]] } },
];

describe('telemetry store', () => {
  beforeEach(() => {
    useTelemetryStore.setState({
      hydrated: false,
      vehicles: {},
      vehicleIds: [],
      routes: {},
      zones: {},
      telemetry: {},
    });
  });

  it('seeds the world from a snapshot and orders stops by seq', () => {
    useTelemetryStore.getState().applySnapshot({
      vehicles: [vehicle('veh-10', 'Unit 10'), vehicle('veh-2', 'Unit 2')],
      routes: [route],
      stops,
      zones,
      telemetry: [telemetry('veh-2'), telemetry('veh-10')],
    });
    const state = useTelemetryStore.getState();
    expect(state.hydrated).toBe(true);
    // Natural-numeric label order: Unit 2 before Unit 10.
    expect(state.vehicleIds).toEqual(['veh-2', 'veh-10']);
    expect(state.routes['route-1']?.stops.map((s) => s.id)).toEqual(['stop-1', 'stop-2']);
    expect(state.zones['zone-1']?.name).toBe('Aliados Delivery');
  });

  it('replaces only the vehicles in a tick (unchanged keep their reference)', () => {
    const store = useTelemetryStore.getState();
    store.applySnapshot({
      vehicles: [vehicle('veh-1', 'Unit 1'), vehicle('veh-2', 'Unit 2')],
      routes: [route],
      stops,
      zones,
      telemetry: [telemetry('veh-1'), telemetry('veh-2')],
    });
    const before = useTelemetryStore.getState().telemetry;
    const unchangedRef = before['veh-2'];

    useTelemetryStore.getState().applyTick([telemetry('veh-1', { progress: 0.9, etaSeconds: 10 })]);
    const after = useTelemetryStore.getState().telemetry;
    expect(after['veh-1']?.progress).toBe(0.9);
    // The vehicle not in the tick keeps its exact reference (no spurious row re-render).
    expect(after['veh-2']).toBe(unchangedRef);
  });

  it('an empty tick is a no-op', () => {
    const store = useTelemetryStore.getState();
    store.applySnapshot({
      vehicles: [vehicle('veh-1', 'Unit 1')],
      routes: [route],
      stops,
      zones,
      telemetry: [telemetry('veh-1')],
    });
    const before = useTelemetryStore.getState().telemetry;
    useTelemetryStore.getState().applyTick([]);
    expect(useTelemetryStore.getState().telemetry).toBe(before);
  });
});
