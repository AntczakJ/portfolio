'use client';

import { Map as MapIcon, Table2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import { MapRegion } from '@/components/map/map-region';
import { DegradationNotice } from '@/components/dashboard/degradation-notice';
import { FleetTableView } from '@/components/dashboard/fleet-table-view';
import { DemoControl } from '@/components/panels/demo-control';
import { cn } from '@/lib/cn';
import { isWebglAvailable } from '@/lib/map/webgl-support';
import {
  resolveEffectiveView,
  useViewModeStore,
  type ViewPreference,
} from '@/lib/store/view-mode-store';

/**
 * OpsSurface (Task 6.1) — the centre surface that swaps between the live map and
 * the full-width fleet table, the heart of the no-WebGL degradation arm.
 *
 * It probes WebGL availability on mount (capability), reads the user preference
 * (a first-class toggle), and resolves which surface renders:
 *   - WebGL present + preference map/auto → the live MapLibre canvas (the wow),
 *   - WebGL absent OR preference table     → the full-width fleet table (the same
 *                                            live data from the same socket).
 *
 * The table is BOTH the no-WebGL fallback AND a deliberate user choice (the toggle
 * is always available). When the map is up, the toggle lets any user switch to
 * the table view; when WebGL is unavailable the toggle's "Map" option is disabled
 * and a non-blocking notice explains why.
 *
 * Critically the SOCKET does not change with the surface — the live-telemetry
 * stores are fed once (by the MapCanvas's hook when the map is up, or here when
 * it is not). See `FleetTableView` for the table-only telemetry wiring.
 */
export function OpsSurface(): ReactNode {
  const webglAvailable = useViewModeStore((s) => s.webglAvailable);
  const probed = useViewModeStore((s) => s.probed);
  const preference = useViewModeStore((s) => s.preference);
  const setWebglAvailable = useViewModeStore((s) => s.setWebglAvailable);
  const setPreference = useViewModeStore((s) => s.setPreference);

  // Probe WebGL once on mount (client-only). Until then we render neutral — the
  // server render and first client paint must match (no map in the server bundle
  // anyway, the MapRegion is ssr:false), so we hold the table-less map slot until
  // the probe resolves to avoid a flash.
  useEffect(() => {
    setWebglAvailable(isWebglAvailable());
  }, [setWebglAvailable]);

  const effective = resolveEffectiveView(preference, webglAvailable);
  const reduce = useReducedMotion();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ViewToggle
        preference={preference}
        webglAvailable={webglAvailable}
        onChange={setPreference}
      />

      {/* The non-blocking notice: explains the fallback when WebGL is absent, or
          when the user is in the table view by choice. Never blocks the data. */}
      <DegradationNotice
        probed={probed}
        webglAvailable={webglAvailable}
        effectiveView={effective}
        preference={preference}
      />

      {/* P1-5: a considered, reduced-motion-safe crossfade for the map<->table
          swap (Linear easing), instead of a lazy hard cut. Under reduced motion
          the duration collapses to ~0 (an instant, motion-free swap). The map
          and table are mutually exclusive (one socket) — only one is keyed in
          the presence at a time. */}
      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={effective}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0"
          >
            {effective === 'map' ? (
              <>
                <MapRegion />
                <div className="pointer-events-none absolute bottom-3 left-3 z-10">
                  <div className="pointer-events-auto">
                    <DemoControl />
                  </div>
                </div>
              </>
            ) : (
              <FleetTableView mapUnavailable={!webglAvailable} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ViewToggle({
  preference,
  webglAvailable,
  onChange,
}: {
  preference: ViewPreference;
  webglAvailable: boolean;
  onChange: (preference: ViewPreference) => void;
}): ReactNode {
  // When WebGL is unavailable the map cannot render, so the Map option is
  // disabled (we cannot honour it). The toggle stays visible so a user
  // understands the table is intentional, not a broken map.
  const showMap = preference === 'auto' || preference === 'map';
  const tablePressed = preference === 'table';

  return (
    <div
      role="group"
      aria-label="Operations view"
      className="border-border bg-surface-2 inline-flex w-fit items-center gap-0.5 rounded-md border p-0.5"
    >
      <ToggleButton
        active={showMap && webglAvailable}
        disabled={!webglAvailable}
        onClick={() => {
          onChange('map');
        }}
        icon={<MapIcon className="size-3.5" aria-hidden="true" />}
        label="Map"
        title={
          webglAvailable
            ? 'Show the live operations map'
            : 'The live map needs WebGL, which is unavailable in this browser'
        }
      />
      <ToggleButton
        active={tablePressed || !webglAvailable}
        disabled={false}
        onClick={() => {
          onChange('table');
        }}
        icon={<Table2 className="size-3.5" aria-hidden="true" />}
        label="Table"
        title="Show the fleet as a keyboard-navigable table (same live data)"
      />
    </div>
  );
}

function ToggleButton({
  active,
  disabled,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title: string;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={cn(
        'focus-visible:ring-accent inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
        disabled && 'cursor-not-allowed opacity-40',
        active && !disabled
          ? 'bg-surface-3 text-foreground'
          : 'text-fg-muted hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
