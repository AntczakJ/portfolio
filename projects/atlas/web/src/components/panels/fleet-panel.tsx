import type { ReactNode } from 'react';

import { PanelEmpty, PanelShell } from '@/components/panels/panel-shell';
import { getStaticFleetSnapshot } from '@/mocks/static-fleet';

/**
 * Fleet panel (Task 2.1 placeholder).
 *
 * Phase 5 makes this the FIRST-CLASS fleet list — and the accessible non-map
 * alternative + no-WebGL fallback (every vehicle with status, zone, speed, %
 * complete, live ETA; keyboard-focusable rows; Enter focuses a vehicle). It is
 * deliberately built early (Task 5.1) for exactly that a11y reason. For Phase 2
 * it renders the seeded fleet count + a static roster preview so the shell + the
 * layout are reviewable, with the live data wired in Phase 4/5.
 *
 * A Server Component: the seeded snapshot is deterministic and needs no client
 * state this phase.
 */
export function FleetPanel(): ReactNode {
  const { vehicles } = getStaticFleetSnapshot();

  return (
    <PanelShell title="Fleet" meta={`${vehicles.length.toLocaleString()} units`}>
      <ul className="flex flex-col gap-1.5">
        {vehicles.slice(0, 6).map((v) => (
          <li
            key={v.id}
            className="border-border bg-surface-2 flex items-center justify-between rounded-md border px-2.5 py-2"
          >
            <span className="text-foreground text-sm font-medium">
              {v.label}
            </span>
            <span className="text-fg-subtle font-mono text-2xs tracking-wide uppercase">
              {v.status.replace('_', ' ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-fg-subtle mt-3 text-2xs leading-normal">
        Live list with status, zone, speed, ETA and keyboard focus lands with the
        telemetry stream. This roster is the keyboard-navigable, non-map view.
      </p>
    </PanelShell>
  );
}

/**
 * Vehicle detail panel (Task 2.1 placeholder; Phase 5 = Motion slide-in detail).
 */
export function DetailPanel(): ReactNode {
  return (
    <PanelShell title="Vehicle">
      <PanelEmpty>
        Select a vehicle on the map or in the fleet list to pin its route, stops,
        live ETA, speed and recent events here.
      </PanelEmpty>
    </PanelShell>
  );
}

/**
 * Live events feed panel (Task 2.1 placeholder; Phase 5 = AnimatePresence feed
 * with aria-live announcements + the geofence beat).
 */
export function EventsPanel(): ReactNode {
  return (
    <PanelShell title="Events" meta="live">
      <PanelEmpty>
        Geofence enter / exit and status changes will materialise here as the
        fleet crosses zone boundaries, newest first.
      </PanelEmpty>
    </PanelShell>
  );
}
