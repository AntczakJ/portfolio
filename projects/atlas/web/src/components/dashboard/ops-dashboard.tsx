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
 * Responsive (P1-1 fix): on `lg`+ the layout is a FIXED-HEIGHT control room — a
 * full-viewport three-region grid that does not scroll (the map breathes). BELOW
 * `lg` it becomes a single SCROLLING column: the map takes a tall fixed block,
 * then the fleet roster, detail and events flow beneath it at their natural
 * height. The previous `h-dvh` + `overflow-hidden` trapped the stacked column and
 * left a large black void below a few fleet rows — here the narrow column scrolls
 * and fills, so a dispatcher on a phone gets a usable layout from 320px up.
 *
 * A Server Component shell mounting client islands (the map region, the top-bar
 * client bits) — the `'use client'` boundary stays as low as possible.
 */
export function OpsDashboard(): ReactNode {
  return (
    // lg+: lock to the viewport (no page scroll, the control-room register).
    // Below lg: a normal scrolling document (min-h-dvh, no overflow trap).
    <div className="bg-background flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <TopBar />

      <main
        id="main"
        className="grid flex-1 gap-2.5 p-2.5 lg:min-h-0 lg:grid-cols-[var(--panel-width)_minmax(0,1fr)_var(--panel-width-wide)]"
      >
        {/* Fleet rail (left). On lg it is a full-height rail; below lg it drops
            under the map in the reflow below. */}
        <div className="hidden min-h-0 flex-col lg:flex">
          <FleetPanel />
        </div>

        {/* Operations surface — the live map OR the full-width fleet table (the
            no-WebGL fallback + a first-class user toggle). The demo affordance
            floats over the map when it is the active surface. On small screens it
            takes a fixed tall block; on lg it fills the centre column. */}
        <div className="relative h-[60vh] min-h-[22rem] lg:h-auto lg:min-h-0">
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

        {/* Narrow-viewport reflow: the three panels stacked beneath the map,
            flowing at their natural height inside the scrolling column. Visible
            below lg only. The fleet roster (the non-map view) comes first as the
            most useful glance surface. */}
        <div className="flex flex-col gap-2.5 lg:hidden">
          <FleetPanel />
          <DetailPanel />
          <EventsPanel />
        </div>
      </main>
    </div>
  );
}
