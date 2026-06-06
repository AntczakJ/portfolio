import type { ReactNode } from 'react';

import { TopBar } from '@/components/chrome/top-bar';
import { OpsSurface } from '@/components/dashboard/ops-surface';
import { DetailPanel } from '@/components/panels/detail-panel';
import { EventsPanel } from '@/components/panels/events-panel';
import { FleetPanel } from '@/components/panels/fleet-panel';

/**
 * OpsDashboard — the control-room app shell (Task 2.1).
 *
 * Layout (desktop, >= lg): a full-height column with the persistent top bar, and
 * below it a three-region grid — the fleet panel (left), the MAP centerpiece
 * (centre, the wow surface), and a right rail stacking the vehicle detail + the
 * live events feed. The map owns the most space; the panels are fixed-width
 * rails so the map breathes.
 *
 * Responsive: below `lg` the side panels move under the map (the map stays the
 * lead surface but the rails reflow to a stacked column); below `md` the layout
 * is a single scroll column with the map first, then the fleet roster (the
 * non-map view), then events. Phase 6 turns the narrow-screen panels into
 * bottom-sheets / tabs and wires the no-WebGL table fallback — this scaffold
 * establishes the reflow skeleton.
 *
 * A Server Component shell mounting client islands (the map region, the top-bar
 * client bits) — the `'use client'` boundary stays as low as possible.
 */
export function OpsDashboard(): ReactNode {
  return (
    <div className="bg-background flex h-dvh flex-col overflow-hidden">
      <TopBar />

      <main
        id="main"
        className="grid min-h-0 flex-1 gap-2.5 p-2.5 lg:grid-cols-[var(--panel-width)_minmax(0,1fr)_var(--panel-width-wide)]"
      >
        {/* Fleet rail (left). On lg it is a full-height rail; below lg it drops
            under the map in the reflow below. */}
        <div className="hidden min-h-0 flex-col lg:flex">
          <FleetPanel />
        </div>

        {/* Operations surface — the live map OR the full-width fleet table (the
            no-WebGL fallback + a first-class user toggle). The demo affordance
            floats over the map when it is the active surface. On small screens it
            takes a fixed tall block at the top. */}
        <div className="relative min-h-[24rem] lg:min-h-0">
          <OpsSurface />
        </div>

        {/* Right rail (detail + events). Hidden on lg-down; the reflow block
            below renders the panels stacked for narrower viewports. */}
        <div className="hidden min-h-0 flex-col gap-2.5 lg:flex">
          <div className="min-h-0 flex-1">
            <DetailPanel />
          </div>
          <div className="min-h-0 flex-1">
            <EventsPanel />
          </div>
        </div>

        {/* Narrow-viewport reflow: the three panels stacked beneath the map.
            Visible below lg only. The fleet roster (the non-map view) comes
            first as the most useful glance surface. */}
        <div className="flex flex-col gap-2.5 lg:hidden">
          <FleetPanel />
          <DetailPanel />
          <EventsPanel />
        </div>
      </main>
    </div>
  );
}
