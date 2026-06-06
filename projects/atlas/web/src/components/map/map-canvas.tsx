'use client';

import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { getStaticFleetSnapshot } from '@/mocks/static-fleet';
import { resolveBasemapTheme } from '@/lib/map/basemap-style';
import { AtlasMapController } from '@/lib/map/map-controller';
import { useOpsStore } from '@/lib/store/ops-store';

/**
 * MapCanvas — the `'use client'` boundary around the imperative AtlasMapController
 * (Task 2.2).
 *
 * This component owns the DOM container and the controller lifecycle; it does NOT
 * own the map's per-frame state. The controller (a plain class) holds the
 * MapLibre instance off the React render path. React's only jobs here:
 *   - mount the controller once (a ref, not state — it must not re-create on
 *     render),
 *   - bridge next-themes → `controller.setTheme()` (theme switch swaps the
 *     basemap style, not just the chrome),
 *   - bridge `prefers-reduced-motion` → `controller.setReducedMotion()`,
 *   - bridge marker click → the Zustand selection store (Phase 5 panels read it).
 *
 * Phase 4 will mount its WS client + rAF loop alongside this and call
 * `controller.setVehiclesGeoJSON()` per frame — this component does not change.
 *
 * The static seeded snapshot stands in for the backend snapshot frame until
 * Phase 4. Building it in a ref (not state) keeps it stable.
 */
export function MapCanvas(): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AtlasMapController | null>(null);
  const snapshotRef = useRef(getStaticFleetSnapshot());
  const { resolvedTheme } = useTheme();
  const selectVehicle = useOpsStore((s) => s.selectVehicle);
  const [ready, setReady] = useState(false);

  // The controller mounts exactly once and is imperative; it must NOT re-create
  // on a theme/selection change. We read the live theme + the (stable) Zustand
  // action through refs so the mount effect has no reactive dependencies, while
  // still seeing current values at mount time without going stale.
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;
  const selectVehicleRef = useRef(selectVehicle);
  selectVehicleRef.current = selectVehicle;

  // Mount the controller exactly once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || controllerRef.current) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const controller = new AtlasMapController({
      container,
      theme: resolveBasemapTheme(resolvedThemeRef.current),
      snapshot: snapshotRef.current,
      reducedMotion,
      onVehicleSelect: (id) => {
        selectVehicleRef.current(id);
        controller.focusVehicle(id);
      },
      onReady: () => {
        setReady(true);
      },
    });
    controllerRef.current = controller;

    // Bridge reduced-motion changes to the controller (camera fly vs cut).
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMqChange = (ev: MediaQueryListEvent) => {
      controller.setReducedMotion(ev.matches);
    };
    mq.addEventListener('change', onMqChange);

    // Resize the map when its container changes size (panels collapsing, etc).
    const resizeObserver = new ResizeObserver(() => {
      controller.resize();
    });
    resizeObserver.observe(container);

    return () => {
      mq.removeEventListener('change', onMqChange);
      resizeObserver.disconnect();
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  // Bridge theme changes → swap the basemap style (the toggle switches the map,
  // not just the chrome — ADR-006 success criterion).
  useEffect(() => {
    controllerRef.current?.setTheme(resolveBasemapTheme(resolvedTheme));
  }, [resolvedTheme]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        role="region"
        aria-label="Live fleet operations map. Tab to the map, then use arrow keys to pan and plus or minus to zoom. A keyboard-navigable fleet table carries the same data."
        className="live-grid h-full w-full"
      />
      {!ready ? (
        <div
          className="bg-background/60 text-fg-muted pointer-events-none absolute inset-0 flex items-center justify-center text-sm backdrop-blur-sm"
          aria-hidden="true"
        >
          <span className="font-mono tracking-wider uppercase">
            Initialising map
          </span>
        </div>
      ) : null}
    </div>
  );
}
