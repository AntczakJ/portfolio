import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from 'maplibre-gl';

import type { FleetSnapshot } from '@/lib/fleet/types';

/**
 * App-layer GeoJSON builders + layer specs for the fleet/routes/zones.
 *
 * These are the layers the rAF interpolation loop (Phase 4) will update via
 * `source.setData()` OFF the React render path — never React state per frame.
 * Phase 2 sets them once from the static fixture; the source ids + the layer
 * paint are the stable contract Phase 4 plugs into (update the
 * `SOURCE_VEHICLES` data each frame; the layers do not change).
 *
 * Colours are read from CSS custom properties at build time via a resolver so
 * the map layers track the sovereign tokens + theme. MapLibre paint values are
 * plain colour strings (it cannot read CSS vars), so we resolve the computed
 * token value from the document and re-resolve on theme switch.
 */

export const SOURCE_VEHICLES = 'atlas-vehicles';
export const SOURCE_ROUTES = 'atlas-routes';
export const SOURCE_ZONES = 'atlas-zones';
/** The fading tail BEHIND each vehicle (where it has been). Updated per frame. */
export const SOURCE_TRAILS = 'atlas-trails';
/** The planned path AHEAD of each vehicle (current -> next stop). Per frame. */
export const SOURCE_REMAINING = 'atlas-remaining';

export const LAYER_ZONE_FILL = 'atlas-zone-fill';
export const LAYER_ZONE_LINE = 'atlas-zone-line';
export const LAYER_ROUTE_LINE = 'atlas-route-line';
export const LAYER_TRAIL_LINE = 'atlas-trail-line';
export const LAYER_REMAINING_LINE = 'atlas-remaining-line';
export const LAYER_VEHICLE_DOT = 'atlas-vehicle-dot';
export const LAYER_VEHICLE_HEADING = 'atlas-vehicle-heading';
export const LAYER_VEHICLE_LABEL = 'atlas-vehicle-label';

/** Resolved status/zone colours from the live CSS custom properties. */
export interface MapPalette {
  enroute: string;
  atstop: string;
  idle: string;
  returning: string;
  zoneDepot: string;
  zoneDelivery: string;
  zoneRestricted: string;
  route: string;
  /** Signal amber — the live/active accent (remaining-route + zone pulse). */
  accent: string;
  /** The fading trail colour (the en-route status colour reads as "live"). */
  trail: string;
  label: string;
  labelHalo: string;
}

/** Read a CSS custom property off the document root (theme-resolved). */
function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Resolve the map palette from the current theme's CSS variables. */
export function readMapPalette(): MapPalette {
  return {
    enroute: readVar('--color-status-enroute', '#36d399'),
    atstop: readVar('--color-status-atstop', '#f6a821'),
    idle: readVar('--color-status-idle', '#8a97a9'),
    returning: readVar('--color-status-returning', '#8b9dff'),
    zoneDepot: readVar('--color-zone-depot', '#8b9dff'),
    zoneDelivery: readVar('--color-zone-delivery', '#36d399'),
    zoneRestricted: readVar('--color-zone-restricted', '#ff6b81'),
    route: readVar('--color-border-strong', '#34465f'),
    accent: readVar('--color-accent', '#f6a821'),
    trail: readVar('--color-status-enroute', '#36d399'),
    label: readVar('--color-foreground', '#e6ecf3'),
    labelHalo: readVar('--color-background', '#0b1018'),
  };
}

/* -------------------------------------------------------------------------
 * GeoJSON FeatureCollection builders from a snapshot.
 * --------------------------------------------------------------------- */

/**
 * The short marker label for a vehicle — the HUMAN identifier, unified with the
 * panels/feed (P1-3 fix: markers must not show the `veh-N` slug while the panels
 * show `Unit N`). Derives a compact `U<n>` glyph from the human label so the dot
 * stays legible at city zoom: "Unit 7" -> "U7", "Truck 12" -> "T12". Falls back
 * to the first 3 chars of the label, never the raw id.
 */
export function shortVehicleLabel(label: string): string {
  const match = /([a-z])[a-z]*\s*(\d+)/i.exec(label);
  const initial = match?.[1];
  const number = match?.[2];
  if (initial && number) return `${initial.toUpperCase()}${number}`;
  return label.slice(0, 3).toUpperCase();
}

export function buildVehiclesGeoJSON(snapshot: FleetSnapshot): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: snapshot.vehicles.map((v) => ({
      type: 'Feature',
      id: v.id,
      properties: {
        id: v.id,
        label: v.label,
        marker: shortVehicleLabel(v.label),
        status: v.status,
        heading: v.heading,
        type: v.type,
      },
      geometry: { type: 'Point', coordinates: v.position },
    })),
  };
}

export function buildRoutesGeoJSON(snapshot: FleetSnapshot): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: snapshot.routes.map((r) => ({
      type: 'Feature',
      id: r.id,
      properties: { id: r.id, name: r.name },
      geometry: { type: 'LineString', coordinates: r.geometry },
    })),
  };
}

export function buildZonesGeoJSON(snapshot: FleetSnapshot): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: snapshot.zones.map((z) => ({
      type: 'Feature',
      id: z.id,
      properties: { id: z.id, name: z.name, kind: z.kind },
      geometry: { type: 'Polygon', coordinates: [z.ring] },
    })),
  };
}

/* -------------------------------------------------------------------------
 * Layer spec builders. Markers use a circle + a rotated triangle for heading
 * (no sprite/glyph server needed — keyless + same-origin). The status colour is
 * a data-driven `match` on the `status` property, recoloured on theme switch by
 * re-applying paint with the new palette.
 * --------------------------------------------------------------------- */

function statusColourExpr(palette: MapPalette): ExpressionSpecification {
  return [
    'match',
    ['get', 'status'],
    'en_route',
    palette.enroute,
    'at_stop',
    palette.atstop,
    'idle',
    palette.idle,
    'returning',
    palette.returning,
    palette.enroute,
  ];
}

function zoneColourExpr(palette: MapPalette): ExpressionSpecification {
  return [
    'match',
    ['get', 'kind'],
    'depot',
    palette.zoneDepot,
    'delivery_zone',
    palette.zoneDelivery,
    'restricted',
    palette.zoneRestricted,
    palette.zoneDelivery,
  ];
}

const MAJOR_ROAD_FILTER: FilterSpecification = ['has', 'id'];

export function buildAppLayers(palette: MapPalette): LayerSpecification[] {
  return [
    // Zones — fill + outline, low opacity so the fleet pops.
    {
      id: LAYER_ZONE_FILL,
      type: 'fill',
      source: SOURCE_ZONES,
      paint: {
        'fill-color': zoneColourExpr(palette),
        'fill-opacity': 0.08,
      },
    },
    {
      id: LAYER_ZONE_LINE,
      type: 'line',
      source: SOURCE_ZONES,
      paint: {
        'line-color': zoneColourExpr(palette),
        'line-width': 1.25,
        'line-opacity': 0.55,
        'line-dasharray': [3, 2],
      },
    },
    // Routes — thin planned-path lines beneath the markers.
    {
      id: LAYER_ROUTE_LINE,
      type: 'line',
      source: SOURCE_ROUTES,
      filter: MAJOR_ROAD_FILTER,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': palette.route,
        'line-width': 2,
        'line-opacity': 0.7,
      },
    },
    // Remaining route AHEAD — the planned path from each vehicle's current
    // position to its next stop (signal amber, the "intent" line). Off-render
    // updated by the rAF loop (Task 4.3). Drawn over the base route, under the
    // markers.
    {
      id: LAYER_REMAINING_LINE,
      type: 'line',
      source: SOURCE_REMAINING,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': palette.accent,
        'line-width': 2.5,
        'line-opacity': 0.85,
      },
    },
    // Trail BEHIND — the recent stretch the vehicle has covered, fading from the
    // marker backwards (a line-gradient along the slice). Reads as "where it has
    // been" (Task 4.3).
    {
      id: LAYER_TRAIL_LINE,
      type: 'line',
      source: SOURCE_TRAILS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': palette.trail,
        'line-width': 3,
        // Fade the tail from transparent (oldest) to solid (at the vehicle).
        'line-gradient': [
          'interpolate',
          ['linear'],
          ['line-progress'],
          0,
          'rgba(0,0,0,0)',
          1,
          palette.trail,
        ],
      },
    },
    // Vehicle heading wedge — a rotated triangle (sized in px, rotated by the
    // per-feature `heading`). Drawn under the dot so the dot caps it cleanly.
    {
      id: LAYER_VEHICLE_HEADING,
      type: 'symbol',
      source: SOURCE_VEHICLES,
      layout: {
        'icon-image': 'atlas-heading-wedge',
        'icon-rotate': ['get', 'heading'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1],
      },
    },
    // Vehicle dot — the status-coloured marker body.
    {
      id: LAYER_VEHICLE_DOT,
      type: 'circle',
      source: SOURCE_VEHICLES,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 7],
        'circle-color': statusColourExpr(palette),
        'circle-stroke-width': 1.5,
        'circle-stroke-color': palette.labelHalo,
      },
    },
    // Vehicle label — the HUMAN unit id ("U7"), drawn from zoom 13.5 so the map
    // is not cluttered at city scale. KEYLESS: the keyless basemap has NO glyph
    // server, so a `text-field` label silently no-ops. We instead pre-render a
    // canvas image PER short-label (registered by the controller) and place it
    // as an `icon-image` keyed on the per-feature `marker` property — so the
    // human label renders WITHOUT a glyph endpoint, unified with the panels
    // (P1-3 fix: no `veh-N` slug anywhere in the visible UI).
    {
      id: LAYER_VEHICLE_LABEL,
      type: 'symbol',
      source: SOURCE_VEHICLES,
      minzoom: 13.5,
      layout: {
        'icon-image': ['concat', LABEL_IMAGE_PREFIX, ['get', 'marker']],
        'icon-offset': [0, 16],
        'icon-anchor': 'top',
        'icon-allow-overlap': false,
        'icon-optional': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13.5, 0.85, 16, 1],
      },
    },
  ];
}

/** Prefix for the per-short-label canvas images registered as MapLibre images. */
export const LABEL_IMAGE_PREFIX = 'atlas-label-';

/**
 * A small canvas-drawn label chip ("U7") registered as a MapLibre image so the
 * vehicle label renders WITHOUT a glyph server (keyless). A rounded pill with
 * the label text in the foreground colour over a haloed dark backing — legible
 * over the map at city zoom. Returns ImageData; re-registered on theme switch.
 */
export function createLabelImage(
  text: string,
  fg: string,
  bg: string,
): { data: ImageData; pixelRatio: number } {
  const ratio = 2;
  const padX = 5 * ratio;
  const h = 15 * ratio;
  const fontPx = 9 * ratio;
  // Measure on a scratch context.
  const scratch = document.createElement('canvas').getContext('2d');
  const font = `600 ${String(fontPx)}px ui-sans-serif, system-ui, sans-serif`;
  let textW = text.length * fontPx * 0.6;
  if (scratch) {
    scratch.font = font;
    textW = scratch.measureText(text).width;
  }
  const w = Math.ceil(textW + padX * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { data: new ImageData(w, h), pixelRatio: ratio };

  ctx.clearRect(0, 0, w, h);
  // Rounded backing pill.
  const r = 4 * ratio;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(w, 0, w, h, r);
  ctx.arcTo(w, h, 0, h, r);
  ctx.arcTo(0, h, 0, 0, r);
  ctx.arcTo(0, 0, w, 0, r);
  ctx.closePath();
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.82;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.fillText(text, w / 2, h / 2 + 0.5 * ratio);

  return { data: ctx.getImageData(0, 0, w, h), pixelRatio: ratio };
}

/**
 * A small canvas-drawn heading-wedge icon, registered as a MapLibre image so the
 * symbol layer can rotate it. Keyless — no sprite server. Returns an ImageData.
 * Colour is the foreground token (re-registered on theme switch).
 */
export function createHeadingWedgeImage(colour: string): ImageData {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new ImageData(size, size);
  }
  ctx.clearRect(0, 0, size, size);
  // An upward-pointing triangle (north); MapLibre rotates it by `heading`.
  ctx.beginPath();
  ctx.moveTo(size / 2, 2);
  ctx.lineTo(size / 2 + 5, 12);
  ctx.lineTo(size / 2 - 5, 12);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
