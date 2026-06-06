import maplibregl, {
  type GeoJSONSource,
  type LngLatLike,
  type Map as MapLibreMap,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import { Protocol } from 'pmtiles';

import { DEMO_CITY_CENTER, DEMO_CITY_ZOOM } from '@/lib/fleet/demo-city';
import type { FleetSnapshot } from '@/lib/fleet/types';
import { buildBasemapStyle, type BasemapTheme } from '@/lib/map/basemap-style';
import {
  buildAppLayers,
  buildRoutesGeoJSON,
  buildVehiclesGeoJSON,
  buildZonesGeoJSON,
  createHeadingWedgeImage,
  LAYER_VEHICLE_DOT,
  readMapPalette,
  SOURCE_ROUTES,
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
}

export class AtlasMapController {
  private readonly map: MapLibreMap;
  private snapshot: FleetSnapshot;
  private theme: BasemapTheme;
  private reducedMotion: boolean;
  private readonly onVehicleSelect: ((id: string) => void) | undefined;
  private destroyed = false;

  constructor(opts: MapControllerOptions) {
    ensurePmtilesProtocol();
    this.snapshot = opts.snapshot;
    this.theme = opts.theme;
    this.reducedMotion = opts.reducedMotion;
    this.onVehicleSelect = opts.onVehicleSelect;

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

    this.map.on('style.load', () => {
      this.addAppLayers();
    });

    this.map.on('load', () => {
      if (!this.destroyed) opts.onReady?.();
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

  /* --------------------------------------------------------------------- */
  /* Imperative API — the Phase 4 contract.                                */
  /* --------------------------------------------------------------------- */

  /** Replace the vehicle source data. Phase 4 calls this PER FRAME with the
   * interpolated positions — a single GPU-side `setData`, no React. */
  setVehiclesGeoJSON(data: ReturnType<typeof buildVehiclesGeoJSON>): void {
    if (this.destroyed) return;
    const source = this.map.getSource<GeoJSONSource>(SOURCE_VEHICLES);
    source?.setData(data);
  }

  /** Replace the full snapshot (e.g. a new WS `snapshot` frame). Re-derives all
   * three sources. Phase 4 uses this on connect/reconnect; per-frame motion uses
   * `setVehiclesGeoJSON` instead. */
  setSnapshot(snapshot: FleetSnapshot): void {
    if (this.destroyed) return;
    this.snapshot = snapshot;
    this.map.getSource<GeoJSONSource>(SOURCE_ZONES)?.setData(buildZonesGeoJSON(snapshot));
    this.map.getSource<GeoJSONSource>(SOURCE_ROUTES)?.setData(buildRoutesGeoJSON(snapshot));
    this.setVehiclesGeoJSON(buildVehiclesGeoJSON(snapshot));
  }

  /** Focus a vehicle: fly (or cut, under reduced-motion) the camera to it. */
  focusVehicle(vehicleId: string): void {
    if (this.destroyed) return;
    const vehicle = this.snapshot.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) return;
    const target = { center: vehicle.position as LngLatLike, zoom: 15.5 };
    if (this.reducedMotion) {
      this.map.jumpTo(target);
    } else {
      this.map.flyTo({ ...target, duration: 900, essential: true });
    }
  }

  /** Swap the basemap style for the given theme + re-add the app layers. */
  setTheme(theme: BasemapTheme): void {
    if (this.destroyed || theme === this.theme) return;
    this.theme = theme;
    // `setStyle` clears layers; `style.load` re-adds the app layers. Diff is
    // off so the full new basemap applies cleanly.
    this.map.setStyle(buildBasemapStyle(theme), { diff: false });
  }

  /** Reduced-motion flag — flips camera focus between fly (animated) and cut. */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  /** Resize hook for layout changes (panels collapsing, viewport resize). */
  resize(): void {
    if (!this.destroyed) this.map.resize();
  }

  /** Tear down the map + listeners. Called on unmount. */
  destroy(): void {
    this.destroyed = true;
    this.map.remove();
  }
}
