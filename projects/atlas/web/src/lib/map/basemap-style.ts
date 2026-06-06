import type { StyleSpecification } from 'maplibre-gl';

import { DEMO_CITY_NAME } from '@/lib/fleet/demo-city';

/**
 * Keyless basemap styles — dark + light (ADR-006).
 *
 * The keyless DEFAULT is a self-hosted Protomaps `.pmtiles` vector extract of
 * the demo-city bbox, served SAME-ORIGIN at `/map/<city>.pmtiles` and read via
 * the `pmtiles://` protocol (registered in the map wrapper). NO third-party
 * tile host, NO paid secret — the hard keyless gate. The CSP stays same-origin
 * only (`connect-src 'self'`); self-hosting deliberately shrinks the surface.
 *
 * Two intentional style JSONs over ONE source (the `protomaps` vector source),
 * swapped by next-themes (Task 2.2): a DARK control-room basemap (the lead
 * register) and a clean LIGHT basemap. Theme-switching calls `map.setStyle()`
 * with the other; the fleet/route/zone layers are re-added after the style
 * loads (the map wrapper owns that re-hydration).
 *
 * DEPLOY FOLLOW-UP (Phase 9): the `.pmtiles` extract for the demo-city bbox
 * must be generated and committed (or built at deploy) to `web/public/map/`.
 * Until then the map initialises with the basemap PAINT (the styled background
 * + graticule feel) and renders the fleet/routes/zones ON TOP — so a fresh
 * checkout with no `.pmtiles` still shows a keyless, CSP-clean, populated map
 * (the fleet is the wow, keyless either way). When the extract is present the
 * vector basemap (roads, water, landuse, buildings) renders beneath the fleet.
 *
 * The Protomaps layer scheme below targets the standard Protomaps basemap
 * vector layer names (`water`, `landuse`, `roads`, `buildings`, `earth`). If a
 * deploy uses a different extract schema, only these layer `source-layer`
 * names + filters need adjusting — the source URL + the app layers do not.
 */

/** Same-origin path to the self-hosted keyless vector extract. */
export const PMTILES_PATH = '/map/porto.pmtiles';

/** The `pmtiles://` URL MapLibre reads via the registered protocol. */
const PMTILES_SOURCE_URL = `pmtiles://${PMTILES_PATH}`;

export type BasemapTheme = 'dark' | 'light';

/** Token-aligned colour ramps for each basemap register (kept in sync with the
 * globals.css control-room tokens; the basemap is part of the sovereign
 * identity and is reviewed in its own right). */
const PALETTE = {
  dark: {
    earth: '#0b1018',
    water: '#0e1a26',
    landuse: '#10161f',
    park: '#0f1c19',
    roadMinor: '#1b2737',
    roadMajor: '#26384d',
    building: '#141d29',
    boundary: '#2a3b52',
    label: '#7e8ca0',
  },
  light: {
    earth: '#eef1f5',
    water: '#d3e2ec',
    landuse: '#e6eaf0',
    park: '#dde9df',
    roadMinor: '#ffffff',
    roadMajor: '#f3f5f8',
    building: '#e1e6ec',
    boundary: '#c7cfda',
    label: '#5a6577',
  },
} satisfies Record<BasemapTheme, Record<string, string>>;

/**
 * Build a MapLibre style for the given theme. The style is self-contained and
 * keyless: a single same-origin `pmtiles://` vector source + paint-only layers
 * coloured from the Atlas palette. `glyphs` is omitted (no label glyph server
 * in the keyless default) — labels are drawn from the app chrome, not the
 * basemap, so the keyless build needs no glyph endpoint and stays same-origin.
 */
export function buildBasemapStyle(theme: BasemapTheme): StyleSpecification {
  const c = PALETTE[theme];

  return {
    version: 8,
    name: `Atlas ${theme} — ${DEMO_CITY_NAME}`,
    // No external glyph/sprite servers: keyless + same-origin only. App markers
    // are an SDF-free symbol layer (Task 2.2) added by the wrapper, not the
    // basemap, so no glyph endpoint is required for the keyless render.
    sources: {
      protomaps: {
        type: 'vector',
        url: PMTILES_SOURCE_URL,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OpenStreetMap</a>',
      },
    },
    layers: [
      // Background earth — also the keyless floor when the .pmtiles is absent.
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': c.earth },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'water',
        paint: { 'fill-color': c.water },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'landuse',
        paint: { 'fill-color': c.landuse, 'fill-opacity': 0.6 },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'buildings',
        minzoom: 13,
        paint: { 'fill-color': c.building, 'fill-opacity': 0.7 },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        paint: {
          'line-color': c.roadMinor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 2.5],
        },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        filter: ['in', 'kind', 'major_road', 'highway', 'medium_road'],
        paint: {
          'line-color': c.roadMajor,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 5],
        },
      },
      {
        id: 'boundaries',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'boundaries',
        paint: {
          'line-color': c.boundary,
          'line-width': 0.6,
          'line-dasharray': [2, 2],
        },
      },
    ],
  };
}

/** Resolve the next-themes `resolvedTheme` to a basemap theme (dark default). */
export function resolveBasemapTheme(resolvedTheme: string | undefined): BasemapTheme {
  return resolvedTheme === 'light' ? 'light' : 'dark';
}
