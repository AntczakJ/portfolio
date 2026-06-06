'use client';

import { Info, MonitorX } from 'lucide-react';
import type { ReactNode } from 'react';

import type { EffectiveView, ViewPreference } from '@/lib/store/view-mode-store';

/**
 * DegradationNotice (Task 6.1) — the non-blocking explanation for the no-WebGL /
 * table-view degradation arm.
 *
 * Two cases, never blocking the data:
 *   1. WebGL unavailable → the table is FORCED. A clear notice explains the live
 *      map needs WebGL and that the table carries the same live data.
 *   2. The user CHOSE the table while WebGL is available → a quieter line noting
 *      the same data, with the map a click away.
 *
 * Renders nothing when the map is the active surface (the map speaks for itself).
 */
export function DegradationNotice({
  probed,
  webglAvailable,
  effectiveView,
  preference,
}: {
  probed: boolean;
  webglAvailable: boolean;
  effectiveView: EffectiveView;
  preference: ViewPreference;
}): ReactNode {
  if (effectiveView === 'map') return null;
  // Avoid a flash before the capability probe resolves on the client.
  if (!probed) return null;

  if (!webglAvailable) {
    return (
      <div
        role="status"
        className="border-status-atstop/40 bg-status-atstop/10 text-fg-muted flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
      >
        <MonitorX className="text-status-atstop mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <span className="text-foreground font-medium">Map unavailable.</span> The
          live map renders on WebGL, which this browser or device does not provide.
          The fleet below is the same live telemetry from the same stream — fully
          sortable and keyboard-navigable.
        </p>
      </div>
    );
  }

  // Table by user choice while the map is available.
  if (preference === 'table') {
    return (
      <div
        role="note"
        className="border-border bg-surface-2 text-fg-subtle flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
      >
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Table view — the same live telemetry as the map. Switch back to{' '}
          <span className="text-fg-muted font-medium">Map</span> any time.
        </p>
      </div>
    );
  }

  return null;
}
