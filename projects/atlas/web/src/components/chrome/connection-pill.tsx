'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Connection status pill (Task 2.1 placeholder; Phase 4 wires it live).
 *
 * In Phase 2 there is no live WebSocket yet, so this honestly reports the SEED
 * state: the map shows the seeded static fleet, not a live stream. Phase 4
 * replaces the static state with the real WS connection status
 * (live / reconnecting / offline) driven by the telemetry client — the
 * "reconnecting indicator" the wow-fallback requires. The visual (a status dot +
 * label) is the stable contract; only the source of the status changes.
 *
 * Mounted-gated to avoid any hydration mismatch on the dot animation.
 */
export function ConnectionPill(): ReactNode {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <span
      className="border-border bg-surface-2 text-fg-muted inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
      // Phase 4: aria-live polite on the status text for SR connection updates.
      title="Seeded snapshot — live telemetry stream connects in a later phase"
    >
      <span
        className="bg-status-idle relative inline-flex size-1.5 rounded-full"
        aria-hidden="true"
        style={mounted ? undefined : { opacity: 0 }}
      />
      <span className="font-mono tracking-wide uppercase">Seed</span>
    </span>
  );
}
