import type { FeatureCollection, LineString, Point } from 'geojson';
import maplibregl, {
  type GeoJSONSource,
  type LngLatLike,
  type Map as MapLibreMap,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import { DEMO_CITY_BBOX, DEMO_CITY_CENTER, DEMO_CITY_ZOOM } from '@/lib/fleet/demo-city';
import type { FleetSnapshot } from '@/lib/fleet/types';
import { buildBasemapStyle, type BasemapTheme } from '@/lib/map/basemap-style';
import {
  buildAppLayers,
  buildRoutesGeoJSON,
  buildVehiclesGeoJSON,
  buildZonesGeoJSON,
  createHeadingWedgeImage,
  createLabelImage,
  LABEL_IMAGE_PREFIX,
  LAYER_VEHICLE_DOT,
  LAYER_ZONE_FILL,
  LAYER_ZONE_LINE,
  readMapPalette,
  shortVehicleLabel,
  SOURCE_REMAINING,
  SOURCE_ROUTES,
  SOURCE_TRAILS,
  SOURCE_VEHICLES,
  SOURCE_ZONES,
} from '@/lib/map/fleet-layers';

/**
 * AtlasMapController — the imperative boundary that owns the MapLibre GL JS
 * instance OFF the React render path (ADR-006, the hard "streaming surface is
 * not React state" gate).
 *
 * React (the `<MapCanvas>` wrapper) constructs this once, hands it a container
 * element + the initial snapshot + theme, and thereafter touches it ONLY through
 * imperative methods. The map instance, its sources, and its layers live here in
 * plain fields — never in React state, never re-created on render.
 *
 * --- PHASE 4 CONTRACT (live WS + rAF interpolation plugs in HERE) -----------
 * The interpolation loop (Task 4.2) will call, per animation frame, off the
 * React render path:
 *
 *   controller.setVehiclesGeoJSON(featureCollection)
 *
 * where `featureCollection` is the interpolated vehicle positions/headings for
 * THIS frame (lerped between the last + next authoritative 1 Hz ticks). That is
 * a single `GeoJSONSource.setData()` call — the cheapest GPU-side update path,
 * no React reconciliation. The controller already owns the `SOURCE_VEHICLES`
 * source + the dot/heading/label layers; Phase 4 only swaps the data each frame.
 * Camera focus uses `flyTo` (MapLibre native, not Motion). `setReducedMotion`
 * flips the camera between `flyTo` (animated) and `jumpTo` (cut) so Phase 4's
 * snap-mode is a controller flag, not a re-implementation.
 *
 * Theme switching (`setTheme`) calls `map.setStyle()` with the other basemap
 * JSON and re-adds the app sources/layers after the new style loads — the fleet
 * never disappears across a theme flip.
 */

let protocolRegistered = false;

/** An empty FeatureCollection — the initial data for the per-frame line sources. */
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Zone-pulse timing (ms): the highlight fades over this window after an event. */
const ZONE_PULSE_MS = 1400;

/** Register the `pmtiles://` protocol once per page (keyless same-origin tiles). */
function ensurePmtilesProtocol(): void {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

export interface MapControllerOptions {
  container: HTMLElement;
  theme: BasemapTheme;
  snapshot: FleetSnapshot;
  reducedMotion: boolean;
  /** Called when a vehicle marker is clicked (focus flow — Phase 5 wires it). */
  onVehicleSelect?: (vehicleId: string) => void;
  /** Called once the first style + app layers are ready (clears the loader). */
  onReady?: () => void;
  /**
   * Called when the WebGL context is lost and not restored within a short grace
   * window (Task 6.1 — the no-WebGL degradation arm). The wrapper responds by
   * flipping the view-mode store to the fleet table fallback (same live data,
   * same socket). The browser may emit `webglcontextlost` under GPU pressure,
   * tab backgrounding, or a driver reset; if it does not restore we degrade
   * rather than show a frozen canvas.
   */
  onContextLost?: () => void;
}

export class AtlasMapController {
  private readonly map: MapLibreMap;
  private snapshot: FleetSnapshot;
  private theme: BasemapTheme;
  /** True once the first style + the `load` event have fired. */
  private styleReady = false;
  /** A theme requested before `styleReady`, applied on `load`. */
  private pendingTheme: BasemapTheme | null = null;
  private reducedMotion: boolean;
  private readonly onVehicleSelect: ((id: string) => void) | undefined;
  private destroyed = false;
  /** Active zone-pulse timers, keyed by zoneId, so a re-pulse cancels cleanly. */
  private readonly pulseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Grace-window timer between `webglcontextlost` and declaring degradation. */
  private contextLostTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce timer for the re-fit-on-resize (P1-2). */
  private resizeFitTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once the user manually moved the camera — suppresses the resize re-fit. */
  private userInteracted = false;
  /** True once the first live WS snapshot has replaced the static fixture. */
  private hadLiveSnapshot = false;
  private readonly onContextLost: (() => void) | undefined;
  /** Bound canvas listeners kept so `destroy()` can remove them cleanly. */
  private readonly handleContextLost: (ev: Event) => void;
  private readonly handleContextRestored: () => void;

  constructor(opts: MapControllerOptions) {
    ensurePmtilesProtocol();
    this.snapshot = opts.snapshot;
    this.theme = opts.theme;
    this.reducedMotion = opts.reducedMotion;
    this.onVehicleSelect = opts.onVehicleSelect;
    this.onContextLost = opts.onContextLost;

    this.map = new maplibregl.Map({
      container: opts.container,
      style: buildBasemapStyle(opts.theme),
      center: DEMO_CITY_CENTER,
      zoom: DEMO_CITY_ZOOM,
      attributionControl: { compact: true },
      // Keyboard navigation enabled (a11y, ADR-006 / success criteria). The
      // canvas is focusable and arrow keys pan, +/- zoom.
      keyboard: true,
      // No telemetry / no external requests beyond the same-origin .pmtiles.
      // `dragRotate` kept on for the control-room feel (bearing rotation).
    });

    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

    // WebGL context-loss handling (Task 6.1). `webglcontextlost` can fire under
    // GPU pressure, a driver reset, or tab backgrounding. We prevent the default
    // (so MapLibre/the browser may attempt a restore) and start a short grace
    // window; if `webglcontextrestored` does not arrive in time we declare the
    // map degraded and let the wrapper swap in the fleet table fallback.
    const canvas = this.map.getCanvas();
    this.handleContextLost = (ev: Event) => {
      ev.preventDefault();
      if (this.contextLostTimer) clearTimeout(this.contextLostTimer);
      this.contextLostTimer = setTimeout(() => {
        this.contextLostTimer = null;
        if (!this.destroyed) this.onContextLost?.();
      }, 1500);
    };
    this.handleContextRestored = () => {
      if (this.contextLostTimer) {
        clearTimeout(this.contextLostTimer);
        this.contextLostTimer = null;
      }
    };
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.map.on('style.load', () => {
      this.addAppLayers();
    });

    this.map.on('load', () => {
      if (this.destroyed) return;
      this.styleReady = true;
      // Apply any theme that was requested before the initial style finished
      // loading (next-themes resolves the system theme AFTER the map mounts, so
      // a `setTheme('light')` can arrive while the dark style is still loading —
      // without this, a prefers-color-scheme: light visitor keeps the dark map).
      if (this.pendingTheme && this.pendingTheme !== this.theme) {
        const pending = this.pendingTheme;
        this.pendingTheme = null;
        this.applyTheme(pending);
      }
      // Fit the camera to the fleet so it fills the viewport at any width — the
      // fixed centre/zoom leaves the fleet a tiny cluster on a 1440px+/2560
      // monitor (the primary device). fitBounds respects the live container size
      // (P1-2 fix).
      this.fitToFleet(false);
      opts.onReady?.();
    });

    // Vehicle click → focus callback (Phase 5 pins the detail panel).
    this.map.on('click', LAYER_VEHICLE_DOT, (e) => {
      const features: MapGeoJSONFeature[] = e.features ?? [];
      const feature = features[0];
      if (!feature) return;
      const id: unknown = feature.properties.id;
      if (typeof id === 'string') this.onVehicleSelect?.(id);
    });
    this.map.on('mouseenter', LAYER_VEHICLE_DOT, () => {
      this.map.getCanvas().style.cursor = 'pointer';
    });
    this.map.on('mouseleave', LAYER_VEHICLE_DOT, () => {
      this.map.getCanvas().style.cursor = '';
    });

    // Mark user-driven camera moves so the resize re-fit does not override a
    // deliberate pan/zoom. `dragstart`/`zoomstart` carry `originalEvent` only
    // when the user initiated them (programmatic moves do not).
    const markInteracted = (e: { originalEvent?: unknown }): void => {
      if (e.originalEvent) this.userInteracted = true;
    };
    this.map.on('dragstart', markInteracted);
    this.map.on('zoomstart', markInteracted);
    this.map.on('rotatestart', markInteracted);
  }

  /** Add the heading-wedge image + the fleet/route/zone sources + app layers to
   * the current style. Called on every `style.load` (initial + theme switch). */
  private addAppLayers(): void {
    if (this.destroyed) return;
    const palette = readMapPalette();

    // Register the canvas-drawn heading wedge as a style image (keyless icon).
    if (!this.map.hasImage('atlas-heading-wedge')) {
      const img = createHeadingWedgeImage(palette.label);
      this.map.addImage('atlas-heading-wedge', img, { pixelRatio: 2 });
    }

    // Register a canvas-drawn label chip per short-label (keyless — no glyph
    // server). Keyed by the short label so the marker shows the human "U7", not
    // the `veh-N` slug (P1-3). Re-registered here on every style.load (initial +
    // theme switch) so the chip recolours with the theme.
    this.registerLabelImages(palette);

    if (!this.map.getSource(SOURCE_ZONES)) {
      this.map.addSource(SOURCE_ZONES, {
        type: 'geojson',
        data: buildZonesGeoJSON(this.snapshot),
      });
    }
    if (!this.map.getSource(SOURCE_ROUTES)) {
      this.map.addSource(SOURCE_ROUTES, {
        type: 'geojson',
        data: buildRoutesGeoJSON(this.snapshot),
      });
    }
    // Remaining-route + trail sources (Task 4.3) — empty until the rAF loop
    // fills them per frame off the interpolated vehicle positions. The trail
    // source needs `lineMetrics` so the layer's `line-gradient` (fade the tail)
    // can read `line-progress`.
    if (!this.map.getSource(SOURCE_REMAINING)) {
      this.map.addSource(SOURCE_REMAINING, { type: 'geojson', data: EMPTY_FC });
    }
    if (!this.map.getSource(SOURCE_TRAILS)) {
      this.map.addSource(SOURCE_TRAILS, {
        type: 'geojson',
        data: EMPTY_FC,
        lineMetrics: true,
      });
    }
    if (!this.map.getSource(SOURCE_VEHICLES)) {
      this.map.addSource(SOURCE_VEHICLES, {
        type: 'geojson',
        data: buildVehiclesGeoJSON(this.snapshot),
      });
    }

    for (const layer of buildAppLayers(palette)) {
      if (!this.map.getLayer(layer.id)) this.map.addLayer(layer);
    }
  }

  /** Register/refresh a canvas label chip per unique short-label in the fleet.
   * `force` re-creates them (theme switch recolours); otherwise only missing
   * ones are added (a new vehicle in a snapshot). Keyless — no glyph server. */
  private registerLabelImages(palette: ReturnType<typeof readMapPalette>, force = true): void {
    const seen = new Set<string>();
    for (const v of this.snapshot.vehicles) {
      const short = shortVehicleLabel(v.label);
      if (seen.has(short)) continue;
      seen.add(short);
      const imageId = `${LABEL_IMAGE_PREFIX}${short}`;
      const exists = this.map.hasImage(imageId);
      if (exists && !force) continue;
      const { data, pixelRatio } = createLabelImage(short, palette.label, palette.labelHalo);
      if (exists) {
        this.map.updateImage(imageId, data);
      } else {
        this.map.addImage(imageId, data, { pixelRatio });
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* Imperative API — the Phase 4 contract.                                */
  /* --------------------------------------------------------------------- */

  /** Replace the vehicle source data. Phase 4 calls this PER FRAME with the
   * interpolated positions — a single GPU-side `setData`, no React. */
  setVehiclesGeoJSON(data: FeatureCollection<Point>): void {
    if (this.destroyed) return;
    const source = this.map.getSource<GeoJSONSource>(SOURCE_VEHICLES);
    source?.setData(data);
  }

  /** Replace the trail (fading tail behind each vehicle) source. Per-frame,
   * off the React render path (Task 4.3). */
  setTrailsGeoJSON(data: FeatureCollection<LineString>): void {
    if (this.destroyed) return;
    this.map.getSource<GeoJSONSource>(SOURCE_TRAILS)?.setData(data);
  }

  /** Replace the remaining-route (planned path ahead) source. Per-frame,
   * off the React render path (Task 4.3). */
  setRemainingGeoJSON(data: FeatureCollection<LineString>): void {
    if (this.destroyed) return;
    this.map.getSource<GeoJSONSource>(SOURCE_REMAINING)?.setData(data);
  }

  /**
   * Pulse a zone on a geofence enter/exit event (Task 4.3): briefly raise the
   * zone fill + outline opacity, then ease it back. A MapLibre PAINT update
   * (`setPaintProperty`) filtered to the one zone — off the React render path,
   * not Motion. Reduced-motion-safe: under reduced motion the highlight is a
   * STATIC raise that holds and clears with no transition (no pulse animation).
   */
  pulseZone(zoneId: string): void {
    if (this.destroyed) return;
    if (!this.map.getLayer(LAYER_ZONE_FILL)) return;

    const existing = this.pulseTimers.get(zoneId);
    if (existing) clearTimeout(existing);

    // A data-driven `case`: the pulsed zone gets the raised opacity + line-width
    // bloom, all others keep the resting value. Re-applied (not transitioned) so
    // multiple zones can pulse independently. P2-2: a CLEARER single eased pulse
    // (a larger fill/line-opacity raise + a line-width bloom) so the geofence
    // beat reads as "the world reacts", not a faint fill bump.
    const raisedFill: maplibregl.DataDrivenPropertyValueSpecification<number> = [
      'case',
      ['==', ['get', 'id'], zoneId],
      0.42,
      0.08,
    ];
    const raisedLine: maplibregl.DataDrivenPropertyValueSpecification<number> = [
      'case',
      ['==', ['get', 'id'], zoneId],
      1,
      0.55,
    ];
    const raisedWidth: maplibregl.DataDrivenPropertyValueSpecification<number> = [
      'case',
      ['==', ['get', 'id'], zoneId],
      3.5,
      1.25,
    ];

    if (!this.reducedMotion) {
      // Ease the paint back over the pulse window (MapLibre transition).
      this.map.setPaintProperty(LAYER_ZONE_FILL, 'fill-opacity-transition', {
        duration: ZONE_PULSE_MS,
      });
      this.map.setPaintProperty(LAYER_ZONE_LINE, 'line-opacity-transition', {
        duration: ZONE_PULSE_MS,
      });
      this.map.setPaintProperty(LAYER_ZONE_LINE, 'line-width-transition', {
        duration: ZONE_PULSE_MS,
      });
    }

    this.map.setPaintProperty(LAYER_ZONE_FILL, 'fill-opacity', raisedFill);
    this.map.setPaintProperty(LAYER_ZONE_LINE, 'line-opacity', raisedLine);
    this.map.setPaintProperty(LAYER_ZONE_LINE, 'line-width', raisedWidth);

    const timer = setTimeout(() => {
      this.pulseTimers.delete(zoneId);
      if (this.destroyed || !this.map.getLayer(LAYER_ZONE_FILL)) return;
      // Reset to the resting opacity + width (the transition eases them down).
      this.map.setPaintProperty(LAYER_ZONE_FILL, 'fill-opacity', 0.08);
      this.map.setPaintProperty(LAYER_ZONE_LINE, 'line-opacity', 0.55);
      this.map.setPaintProperty(LAYER_ZONE_LINE, 'line-width', 1.25);
    }, ZONE_PULSE_MS);
    this.pulseTimers.set(zoneId, timer);
  }

  /** Replace the full snapshot (e.g. a new WS `snapshot` frame). Re-derives all
   * three sources. Phase 4 uses this on connect/reconnect; per-frame motion uses
   * `setVehiclesGeoJSON` instead. */
  setSnapshot(snapshot: FleetSnapshot): void {
    if (this.destroyed) return;
    const firstLive = !this.hadLiveSnapshot;
    this.snapshot = snapshot;
    this.hadLiveSnapshot = true;
    // Ensure a label chip exists for any vehicle in the new snapshot (keyless).
    this.registerLabelImages(readMapPalette(), false);
    this.map.getSource<GeoJSONSource>(SOURCE_ZONES)?.setData(buildZonesGeoJSON(snapshot));
    this.map.getSource<GeoJSONSource>(SOURCE_ROUTES)?.setData(buildRoutesGeoJSON(snapshot));
    this.setVehiclesGeoJSON(buildVehiclesGeoJSON(snapshot));
    // The map mounts on the static fixture; the first live WS snapshot carries
    // the real fleet positions. Re-fit to them (unless the user already moved
    // the camera) so the live fleet fills the viewport (P1-2).
    if (firstLive && this.styleReady && !this.userInteracted) this.fitToFleet(true);
  }

  /** Focus a vehicle: fly (or cut, under reduced-motion) the camera to it.
   * Uses the last snapshot position — `focusVehicleAt` is preferred when the
   * caller (a panel reading the 1 Hz telemetry store) has a fresher position. */
  focusVehicle(vehicleId: string): void {
    if (this.destroyed) return;
    const vehicle = this.snapshot.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return;
    this.flyOrCut(vehicle.position);
  }

  /** Focus a vehicle at an explicit live position. The fleet panel / detail
   * panel read the 1 Hz telemetry store, which is fresher than the controller's
   * last full snapshot, so they fly the camera to the current authoritative
   * position rather than where the vehicle was on the last snapshot. */
  focusVehicleAt(position: [number, number]): void {
    if (this.destroyed) return;
    this.flyOrCut(position);
  }

  private flyOrCut(position: [number, number]): void {
    const target = { center: position as LngLatLike, zoom: 15.5 };
    if (this.reducedMotion) {
      this.map.jumpTo(target);
    } else {
      this.map.flyTo({ ...target, duration: 900, essential: true });
    }
  }

  /**
   * Fit the camera to the fleet bounds so it fills the viewport at any width
   * (P1-2). Computes the bounds from the live vehicle positions, falling back to
   * the demo-city bbox when the fleet is empty or degenerate. A `maxZoom` clamp
   * keeps it from over-zooming on a small/clustered fleet on an ultrawide
   * monitor. `animate=false` for the initial load (no jarring fly on first
   * paint); a resize re-fit also cuts so the world snaps to the new aspect.
   */
  fitToFleet(animate: boolean): void {
    if (this.destroyed) return;

    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const v of this.snapshot.vehicles) {
      const [lng, lat] = v.position;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }

    const haveFleet = west <= east && south <= north && Number.isFinite(west);
    const bounds: [[number, number], [number, number]] = haveFleet
      ? [
          [west, south],
          [east, north],
        ]
      : [
          [DEMO_CITY_BBOX[0], DEMO_CITY_BBOX[1]],
          [DEMO_CITY_BBOX[2], DEMO_CITY_BBOX[3]],
        ];

    this.map.fitBounds(bounds, {
      padding: { top: 56, bottom: 56, left: 56, right: 56 },
      maxZoom: 15.2,
      duration: animate && !this.reducedMotion ? 600 : 0,
    });
  }

  /** Swap the basemap style for the given theme + re-add the app layers. If the
   * initial style has not loaded yet (next-themes resolves the system theme
   * after the map mounts), the request is deferred and applied on `load` — so a
   * prefers-color-scheme: light visitor does NOT keep the dark map (P0-2 fix). */
  setTheme(theme: BasemapTheme): void {
    if (this.destroyed || theme === this.theme) return;
    if (!this.styleReady) {
      this.pendingTheme = theme;
      return;
    }
    this.applyTheme(theme);
  }

  /** Actually swap the MapLibre style for the theme (caller has gated readiness). */
  private applyTheme(theme: BasemapTheme): void {
    this.theme = theme;
    // `setStyle` clears layers; `style.load` re-adds the app layers. Diff is
    // off so the full new basemap applies cleanly.
    this.map.setStyle(buildBasemapStyle(theme), { diff: false });
  }

  /** Reduced-motion flag — flips camera focus between fly (animated) and cut. */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Resize hook for layout changes (panels collapsing, viewport resize). After
   * resizing the canvas, re-fit the fleet to the new aspect (debounced) UNLESS
   * the user has manually panned/zoomed — so an ultrawide monitor keeps the
   * fleet framed (P1-2) without overriding a deliberate camera move. */
  resize(): void {
    if (this.destroyed) return;
    this.map.resize();
    if (this.userInteracted) return;
    if (this.resizeFitTimer) clearTimeout(this.resizeFitTimer);
    this.resizeFitTimer = setTimeout(() => {
      this.resizeFitTimer = null;
      if (!this.destroyed && !this.userInteracted) this.fitToFleet(true);
    }, 180);
  }

  /** Tear down the map + listeners. Called on unmount. */
  destroy(): void {
    this.destroyed = true;
    if (this.contextLostTimer) {
      clearTimeout(this.contextLostTimer);
      this.contextLostTimer = null;
    }
    if (this.resizeFitTimer) {
      clearTimeout(this.resizeFitTimer);
      this.resizeFitTimer = null;
    }
    for (const timer of this.pulseTimers.values()) clearTimeout(timer);
    this.pulseTimers.clear();
    const canvas = this.map.getCanvas();
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.map.remove();
  }
}
