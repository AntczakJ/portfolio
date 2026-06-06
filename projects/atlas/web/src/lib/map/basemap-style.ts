import type { FeatureCollection, LineString } from 'geojson';
import type { StyleSpecification } from 'maplibre-gl';

import { DEMO_CITY_BBOX, DEMO_CITY_NAME } from '@/lib/fleet/demo-city';

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
 * identity and is reviewed in its own right).
 *
 * P0-1 FIX (designer-critic 7.1): the dark `earth` MUST sit ABOVE the app void
 * (`--color-background` #0b1018) so the map plate reads as a deliberate dark
 * slate, not a black hole — especially in the KEYLESS state (no `.pmtiles`, a
 * Phase-9 deploy artifact) where `earth` is the whole visible field. The tones
 * step in clear value tiers (earth < landuse < water/park < buildings < roads)
 * so the plate has depth at zero tiles. A painted graticule + a soft vignette
 * (the `graticule` + `vignette` colours) finish the control-room floor. */
const PALETTE = {
  dark: {
    // Lifted distinctly above the app void (#0b1018) — a backlit slate plate.
    earth: '#10171f',
    water: '#16273a',
    landuse: '#141d28',
    park: '#152318',
    roadMinor: '#243245',
    roadMajor: '#33485f',
    building: '#1a242f',
    boundary: '#3a4f6b',
    label: '#8b99ad',
    /** Painted control-room graticule over the plate (keyless floor). */
    graticule: '#1b2735',
    graticuleMajor: '#24344a',
    /** Soft outer vignette so the plate reads as lit from centre. */
    vignette: '#0b1018',
  },
  light: {
    earth: '#e7ecf2',
    water: '#c6d8e6',
    landuse: '#dde4ec',
    park: '#d4e6d8',
    roadMinor: '#ffffff',
    roadMajor: '#f1f4f8',
    building: '#dadfe7',
    boundary: '#bcc7d4',
    label: '#566175',
    graticule: '#d6dde6',
    graticuleMajor: '#c4cedb',
    vignette: '#cdd6e1',
  },
} satisfies Record<BasemapTheme, Record<string, string>>;

/**
 * Build a painted coordinate-graticule GeoJSON over the demo-city bbox (widened
 * so the lines extend past the visible plate at any zoom). This is the KEYLESS
 * control-room floor: even with NO `.pmtiles`, the dark plate carries a faint
 * lat/lng grid so it reads as a deliberate operations map, not an empty canvas.
 * Pure + deterministic; built once and used by both style JSONs.
 */
function buildGraticule(): { minor: FeatureCollection<LineString>; major: FeatureCollection<LineString> } {
  const [minLng, minLat, maxLng, maxLat] = DEMO_CITY_BBOX;
  // Pad generously so panning/zoom-out never reveals a grid edge.
  const padLng = (maxLng - minLng) * 1.5;
  const padLat = (maxLat - minLat) * 1.5;
  const w = minLng - padLng;
  const e = maxLng + padLng;
  const s = minLat - padLat;
  const n = maxLat + padLat;

  const step = 0.005; // ~0.5 km grid at this latitude — control-room density.
  const minor: LineString[] = [];
  const major: LineString[] = [];

  // Snap to the step grid so lines are stable as the camera moves.
  const startLng = Math.floor(w / step) * step;
  for (let lng = startLng, i = 0; lng <= e; lng += step, i++) {
    const line: LineString = { type: 'LineString', coordinates: [[lng, s], [lng, n]] };
    (i % 4 === 0 ? major : minor).push(line);
  }
  const startLat = Math.floor(s / step) * step;
  for (let lat = startLat, i = 0; lat <= n; lat += step, i++) {
    const line: LineString = { type: 'LineString', coordinates: [[w, lat], [e, lat]] };
    (i % 4 === 0 ? major : minor).push(line);
  }

  const toFc = (lines: LineString[]): FeatureCollection<LineString> => ({
    type: 'FeatureCollection',
    features: lines.map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
  });
  return { minor: toFc(minor), major: toFc(major) };
}

const GRATICULE = buildGraticule();

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
      // Painted control-room graticule (keyless floor — renders with no tiles).
      'atlas-graticule-minor': { type: 'geojson', data: GRATICULE.minor },
      'atlas-graticule-major': { type: 'geojson', data: GRATICULE.major },
    },
    layers: [
      // Background earth — a LIFTED slate plate (above the app void), so even
      // with the .pmtiles absent the map reads as a deliberate dark surface.
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': c.earth },
      },
      // Painted graticule — the keyless control-room floor (minor then major).
      {
        id: 'graticule-minor',
        type: 'line',
        source: 'atlas-graticule-minor',
        paint: {
          'line-color': c.graticule,
          'line-width': 0.6,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 0.8],
        },
      },
      {
        id: 'graticule-major',
        type: 'line',
        source: 'atlas-graticule-major',
        paint: {
          'line-color': c.graticuleMajor,
          'line-width': 1,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 0.9],
        },
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
