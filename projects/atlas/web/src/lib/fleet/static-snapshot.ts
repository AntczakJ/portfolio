import { getStaticFleetSnapshot } from '@/mocks/static-fleet';
import { formatEta, formatSpeed, progressPercent } from '@/lib/fleet/format';
import { statusDescriptor } from '@/lib/fleet/status-descriptor';
import type { VehicleStatus, ZoneKind } from '@/lib/fleet/types';

/**
 * Static, deterministic fleet snapshot for the SSR floor (Task 6.1 / 6.3).
 *
 * The no-JS floor (the landing / public read surface) renders a meaningful fleet
 * table with NO client data dependency: it derives entirely from the seeded
 * static fixture (`faker.seed`-deterministic), so it server-renders identically
 * every request, scores Lighthouse from static content, and is never blank
 * without JavaScript. The LIVE map + live updates honestly require JS (the
 * WebSocket does) — but this surface is meaningful, crawlable, and complete
 * without it.
 *
 * Deliberately NOT fed from the live socket or a REST call: a live data
 * dependency would hurt the Lighthouse first-paint budget and break the no-JS
 * contract. The fixture is the same Porto world the live engine seeds from, so
 * the static floor is representative, not arbitrary.
 *
 * Pure + side-effect-free at module level beyond the deterministic faker seed
 * inside `getStaticFleetSnapshot` — safe to call from a Server Component.
 */

export interface StaticFleetRow {
  id: string;
  label: string;
  status: VehicleStatus;
  statusLabel: string;
  routeName: string;
  zoneName: string | null;
  speed: string;
  progressPct: number;
  eta: string;
}

export interface StaticRouteRef {
  id: string;
  name: string;
  loopMode: 'loop' | 'ping_pong';
  stopCount: number;
  lengthKm: string;
}

export interface StaticZoneRef {
  id: string;
  name: string;
  kind: ZoneKind;
}

export interface StaticSnapshot {
  rows: StaticFleetRow[];
  routes: StaticRouteRef[];
  zones: StaticZoneRef[];
  vehicleCount: number;
  routeCount: number;
  zoneCount: number;
}

/** Build the deterministic static snapshot view model for the SSR floor. */
export function buildStaticSnapshot(): StaticSnapshot {
  const { vehicles, routes, zones } = getStaticFleetSnapshot();

  const routeNameById = new Map(routes.map((r) => [r.id, r.name]));
  const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));

  const rows: StaticFleetRow[] = vehicles
    .map((v) => ({
      id: v.id,
      label: v.label,
      status: v.status,
      statusLabel: statusDescriptor(v.status).label,
      routeName: routeNameById.get(v.routeId) ?? v.routeId,
      zoneName: v.currentZoneId ? (zoneNameById.get(v.currentZoneId) ?? null) : null,
      speed: formatSpeed(v.speedMps),
      progressPct: progressPercent(v.progress),
      eta: formatEta(v.etaSeconds),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  const routeRefs: StaticRouteRef[] = routes.map((r) => ({
    id: r.id,
    name: r.name,
    loopMode: r.loopMode,
    stopCount: r.stops.length,
    lengthKm: (r.lengthM / 1000).toFixed(1),
  }));

  const zoneRefs: StaticZoneRef[] = zones.map((z) => ({
    id: z.id,
    name: z.name,
    kind: z.kind,
  }));

  return {
    rows,
    routes: routeRefs,
    zones: zoneRefs,
    vehicleCount: vehicles.length,
    routeCount: routes.length,
    zoneCount: zones.length,
  };
}
