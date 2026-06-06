import type { LoopMode, ZoneKind } from 'atlas-shared/schemas';

/**
 * Hand-authored Porto demo-city geometry (ADR-005 / ADR-006).
 *
 * STATIC, BAKED coordinates — NOT generated at runtime. The architect pinned
 * "a real compact downtown core, routes hand-authored as GeoJSON LineStrings"
 * over OSM sampling. Every polyline follows a plausible central-Porto street
 * corridor (Aliados / Baixa / Ribeira / Bolhao / Boavista approach) so markers
 * sit on real roads under the keyless Protomaps basemap. Coordinates are GeoJSON
 * `[lng, lat]`.
 *
 * ALL geometry sits INSIDE the web-pinned demo bbox
 * `DEMO_CITY_BBOX = [-8.645, 41.135, -8.585, 41.165]`
 * (web/src/lib/fleet/demo-city.ts) so the keyless `.pmtiles` extract covers it
 * and the FE/BE worlds align (PROGRESS handoff). The geometry seed below mirrors
 * and EXTENDS the Phase-2 web placeholder (static-fleet.ts) — same corridors,
 * more routes/zones/stops, and the authoritative backend version with real
 * stops the engine dwells at.
 *
 * Baking the geometry to a plain module (no faker, no eval) keeps it off the
 * CSP/runtime-eval surface (the faker-to-static-module gotcha): faker is used
 * ONLY for the fleet labels/types/base-speeds (porto-fleet.ts), once, off the
 * hot path.
 */

export interface AuthoredStop {
  readonly id: string;
  readonly seq: number;
  readonly name: string;
  /** GeoJSON [lng, lat]. */
  readonly point: readonly [number, number];
  readonly dwellSeconds: number;
}

export interface AuthoredRoute {
  readonly id: string;
  readonly name: string;
  readonly loopMode: LoopMode;
  /** GeoJSON LineString coordinates, [lng, lat]. */
  readonly geometry: readonly (readonly [number, number])[];
  readonly stops: readonly AuthoredStop[];
}

export interface AuthoredZone {
  readonly id: string;
  readonly name: string;
  readonly kind: ZoneKind;
  /** Outer ring of a GeoJSON Polygon, closed (first === last), [lng, lat]. */
  readonly ring: readonly (readonly [number, number])[];
}

/**
 * Six hand-authored routes across central Porto. A mix of `loop` (depot
 * circuits) and `ping_pong` (linear cross-town corridors) so the route-end
 * behaviour (ADR-002 F1) is exercised both ways and the fleet is always moving.
 * Each route has 2-3 stops the engine dwells at; stop points sit ON the polyline
 * (or are snapped to it at baseline build).
 */
export const PORTO_ROUTES: readonly AuthoredRoute[] = [
  {
    id: 'route-aliados',
    name: 'Aliados Loop',
    loopMode: 'loop',
    geometry: [
      [-8.6112, 41.1466],
      [-8.6109, 41.1483],
      [-8.6107, 41.1496],
      [-8.6105, 41.1509],
      [-8.6098, 41.1521],
      [-8.6082, 41.1528],
      [-8.6064, 41.1531],
      [-8.6058, 41.1518],
      [-8.6065, 41.1502],
      [-8.6085, 41.1486],
      [-8.6112, 41.1466],
    ],
    stops: [
      {
        id: 'route-aliados-stop-1',
        seq: 0,
        name: 'Aliados Pickup',
        point: [-8.6107, 41.1496],
        dwellSeconds: 25,
      },
      {
        id: 'route-aliados-stop-2',
        seq: 1,
        name: 'Trindade Delivery',
        point: [-8.6064, 41.1531],
        dwellSeconds: 35,
      },
    ],
  },
  {
    id: 'route-ribeira',
    name: 'Ribeira Riverside',
    loopMode: 'ping_pong',
    geometry: [
      [-8.6133, 41.1409],
      [-8.6118, 41.1413],
      [-8.6102, 41.142],
      [-8.6089, 41.143],
      [-8.6083, 41.1444],
      [-8.6087, 41.1459],
      [-8.61, 41.1468],
    ],
    stops: [
      {
        id: 'route-ribeira-stop-1',
        seq: 0,
        name: 'Cais da Ribeira',
        point: [-8.6118, 41.1413],
        dwellSeconds: 30,
      },
      {
        id: 'route-ribeira-stop-2',
        seq: 1,
        name: 'Sao Bento Drop',
        point: [-8.61, 41.1468],
        dwellSeconds: 40,
      },
    ],
  },
  {
    id: 'route-baixa',
    name: 'Baixa Cross-town',
    loopMode: 'ping_pong',
    geometry: [
      [-8.6168, 41.1472],
      [-8.6149, 41.1475],
      [-8.6131, 41.1481],
      [-8.6116, 41.149],
      [-8.6104, 41.1502],
      [-8.609, 41.1512],
    ],
    stops: [
      {
        id: 'route-baixa-stop-1',
        seq: 0,
        name: 'Clerigos Pickup',
        point: [-8.6149, 41.1475],
        dwellSeconds: 25,
      },
      {
        id: 'route-baixa-stop-2',
        seq: 1,
        name: 'Bolhao Market',
        point: [-8.609, 41.1512],
        dwellSeconds: 45,
      },
    ],
  },
  {
    id: 'route-bolhao',
    name: 'Bolhao Run',
    loopMode: 'loop',
    geometry: [
      [-8.6075, 41.1471],
      [-8.6068, 41.1485],
      [-8.6058, 41.1498],
      [-8.6044, 41.1507],
      [-8.6028, 41.1512],
      [-8.6012, 41.1514],
      [-8.602, 41.1498],
      [-8.604, 41.1484],
      [-8.6075, 41.1471],
    ],
    stops: [
      {
        id: 'route-bolhao-stop-1',
        seq: 0,
        name: 'Marques Depot',
        point: [-8.6058, 41.1498],
        dwellSeconds: 30,
      },
      {
        id: 'route-bolhao-stop-2',
        seq: 1,
        name: 'Faria Guimaraes',
        point: [-8.6012, 41.1514],
        dwellSeconds: 30,
      },
    ],
  },
  {
    id: 'route-boavista',
    name: 'Boavista Approach',
    loopMode: 'ping_pong',
    geometry: [
      [-8.6298, 41.1538],
      [-8.6265, 41.1535],
      [-8.6231, 41.153],
      [-8.6198, 41.1528],
      [-8.6164, 41.1531],
      [-8.6131, 41.1534],
    ],
    stops: [
      {
        id: 'route-boavista-stop-1',
        seq: 0,
        name: 'Rotunda Boavista',
        point: [-8.6298, 41.1538],
        dwellSeconds: 35,
      },
      {
        id: 'route-boavista-stop-2',
        seq: 1,
        name: 'Casa da Musica',
        point: [-8.6231, 41.153],
        dwellSeconds: 30,
      },
      {
        id: 'route-boavista-stop-3',
        seq: 2,
        name: 'Cedofeita Drop',
        point: [-8.6131, 41.1534],
        dwellSeconds: 40,
      },
    ],
  },
  {
    id: 'route-campanha',
    name: 'Campanha Link',
    loopMode: 'ping_pong',
    geometry: [
      [-8.6012, 41.1486],
      [-8.5983, 41.1478],
      [-8.5954, 41.1469],
      [-8.5928, 41.1456],
      [-8.5905, 41.144],
      [-8.589, 41.1422],
    ],
    stops: [
      {
        id: 'route-campanha-stop-1',
        seq: 0,
        name: 'Heroismo Pickup',
        point: [-8.5983, 41.1478],
        dwellSeconds: 30,
      },
      {
        id: 'route-campanha-stop-2',
        seq: 1,
        name: 'Campanha Yard',
        point: [-8.589, 41.1422],
        dwellSeconds: 50,
      },
    ],
  },
];

/**
 * Five hand-drawn zones (depots + delivery zones + one restricted area) inside
 * the bbox. The routes are authored to cross several of these so the geofence
 * enter/exit wow beat fires reliably (ADR-004) — e.g. the Aliados loop crosses
 * the Aliados delivery zone, the Ribeira route crosses the Ribeira delivery
 * zone, the Bolhao loop crosses the central depot.
 */
export const PORTO_ZONES: readonly AuthoredZone[] = [
  {
    id: 'zone-depot-central',
    name: 'Central Depot',
    kind: 'depot',
    ring: [
      [-8.6075, 41.1455],
      [-8.6048, 41.1455],
      [-8.6048, 41.1474],
      [-8.6075, 41.1474],
      [-8.6075, 41.1455],
    ],
  },
  {
    id: 'zone-delivery-aliados',
    name: 'Aliados Delivery',
    kind: 'delivery_zone',
    ring: [
      [-8.6122, 41.1492],
      [-8.6092, 41.1492],
      [-8.6092, 41.1518],
      [-8.6122, 41.1518],
      [-8.6122, 41.1492],
    ],
  },
  {
    id: 'zone-delivery-ribeira',
    name: 'Ribeira Delivery',
    kind: 'delivery_zone',
    ring: [
      [-8.6128, 41.1408],
      [-8.6088, 41.1408],
      [-8.6088, 41.1436],
      [-8.6128, 41.1436],
      [-8.6128, 41.1408],
    ],
  },
  {
    id: 'zone-delivery-boavista',
    name: 'Boavista Delivery',
    kind: 'delivery_zone',
    ring: [
      [-8.6285, 41.1524],
      [-8.6212, 41.1524],
      [-8.6212, 41.1546],
      [-8.6285, 41.1546],
      [-8.6285, 41.1524],
    ],
  },
  {
    id: 'zone-restricted-sebento',
    name: 'Sao Bento Restricted',
    kind: 'restricted',
    ring: [
      [-8.6112, 41.1455],
      [-8.6088, 41.1455],
      [-8.6088, 41.1474],
      [-8.6112, 41.1474],
      [-8.6112, 41.1455],
    ],
  },
];

/** How many vehicles to spread across each route (in PORTO_ROUTES order). */
export const VEHICLES_PER_ROUTE: readonly number[] = [4, 3, 3, 3, 3, 2];

/** The mulberry32 jitter seed + the faker baseline seed (ADR-002 B1). */
export const SIM_SEED = 414_996;
