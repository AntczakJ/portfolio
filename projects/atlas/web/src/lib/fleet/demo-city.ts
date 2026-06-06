/**
 * Demo city configuration — Porto, Portugal (ADR-005 / ADR-006 coupling).
 *
 * The architect (ADR-005) pinned "a real compact downtown core, routes
 * hand-authored as GeoJSON LineStrings". This web-side config PROPOSES Porto's
 * downtown core (Baixa / Ribeira / Aliados) as the demo city + a small bbox the
 * keyless Protomaps `.pmtiles` extract must cover (ADR-006). It is a compact,
 * recognisable, walkable downtown that reads as a believable delivery operation
 * and keeps the `.pmtiles` extract small.
 *
 * COUPLING NOTE (PROGRESS handoff): the backend seed (Task 3.3) must author its
 * routes/zones over the SAME city + bbox so the keyless basemap covers them.
 * This file is the single web-side source for the centre + bbox; the Phase 2
 * static fixture (`static-fleet.ts`) authors its geometry inside this bbox. When
 * the backend seed lands, the live snapshot replaces the static fixture but the
 * city/bbox stays pinned here for the map's initial camera + the `.pmtiles`
 * extract bounds.
 */

/** Map centre (Avenida dos Aliados / central Porto), GeoJSON [lng, lat]. */
export const DEMO_CITY_CENTER: [number, number] = [-8.6109, 41.1496];

/** Initial camera zoom for the downtown core. */
export const DEMO_CITY_ZOOM = 14.2;

/**
 * The bbox the keyless `.pmtiles` extract must cover, [minLng, minLat, maxLng,
 * maxLat]. A tight box around the downtown core keeps the extract small (the
 * deploy phase generates the `.pmtiles` from this bbox).
 */
export const DEMO_CITY_BBOX: [number, number, number, number] = [-8.645, 41.135, -8.585, 41.165];

export const DEMO_CITY_NAME = 'Porto';
