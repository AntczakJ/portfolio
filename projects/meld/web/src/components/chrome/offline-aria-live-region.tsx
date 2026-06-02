'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useUiStore } from '@/lib/stores/ui-store';

/**
 * `<OfflineAriaLiveRegion />` — Phase 3.4 / ADR-009 assertive screen-
 * reader announcement.
 *
 * Hidden `role="status"` + `aria-live="assertive"` + `aria-atomic="true"`
 * `<div>`, positioned offscreen via Tailwind `sr-only`. Writes a
 * verbatim ADR-009 announcement on every connection-state transition
 * the contract calls out:
 *
 *   1. `live → offline` (or `reconnecting → offline`) — assertive
 *      announcement:
 *        "Offline. Your edits are saved locally and will sync when
 *         the connection returns."
 *
 *   2. `offline → live` with `incomingShapeCount > 0` — assertive
 *      announcement (singular toggle on N === 1):
 *        "Connection restored. {N} {shape|shapes} synced."
 *
 *   3. `offline → live` with `incomingShapeCount === 0` — assertive
 *      announcement:
 *        "Connection restored."
 *
 *   4. `* → overrun` (ADR-010 server `4290` rate-limit close) —
 *      assertive announcement:
 *        "Connection paused — you're editing too fast. Reconnecting
 *         shortly. Your work is saved."
 *      The overrun → live restore re-uses the same `buildRestoredCopy`
 *      path as the offline restore (case 2/3), so a synced delta is
 *      announced identically.
 *
 * Reduced-motion is IRRELEVANT to this component — the aria-live
 * announcement is content, not motion, per ADR-009. We always emit.
 *
 * Implementation: read `connectionState` + `lastReconcileMs` (the
 * incoming-shape count) from the ui-store via selectors; compare with
 * the previous transition tracked in a `useRef`; on a real transition,
 * write the verbatim copy into a React state cell which is the
 * `<div>`'s text content. The cell holds the LAST announced message
 * until the next transition; this is correct for aria-live polite
 * AND assertive — the screen reader announces only the NEW content
 * delta when `aria-atomic="true"` and the text changes.
 */

const COPY_OFFLINE =
  'Offline. Your edits are saved locally and will sync when the connection returns.';
const COPY_OVERRUN =
  "Connection paused — you're editing too fast. Reconnecting shortly. Your work is saved.";
const COPY_RESTORED_NO_DELTA = 'Connection restored.';

function buildRestoredCopy(incomingShapeCount: number): string {
  if (incomingShapeCount <= 0) return COPY_RESTORED_NO_DELTA;
  const noun = incomingShapeCount === 1 ? 'shape' : 'shapes';
  return `Connection restored. ${incomingShapeCount.toString()} ${noun} synced.`;
}

export function OfflineAriaLiveRegion(): ReactNode {
  const connectionState = useUiStore((s) => s.connectionState);
  const lastReconcileMs = useUiStore((s) => s.lastReconcileMs);
  const previousStateRef = useRef<typeof connectionState>(connectionState);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const previousState = previousStateRef.current;
    previousStateRef.current = connectionState;

    if (previousState === connectionState) return;

    // Entering offline — assertive notification regardless of where we
    // came from (`live → offline` is the canonical path; a flap path
    // `reconnecting → offline` ALSO fires after the 1500 ms debounce
    // and gets the same announcement).
    if (connectionState === 'offline') {
      setMessage(COPY_OFFLINE);
      return;
    }

    // Entering overrun (ADR-010 server `4290`) — its own assertive copy.
    if (connectionState === 'overrun') {
      setMessage(COPY_OVERRUN);
      return;
    }

    // Coming back live from a degraded state (offline OR overrun) —
    // three sub-cases all reduce to `buildRestoredCopy(N)`:
    //   - N >  1 → "Connection restored. N shapes synced."
    //   - N === 1 → "Connection restored. 1 shape synced."
    //   - N === 0 → "Connection restored."
    if (
      (previousState === 'offline' || previousState === 'overrun') &&
      connectionState === 'live'
    ) {
      const count = lastReconcileMs ?? 0;
      setMessage(buildRestoredCopy(count));
      return;
    }

    // All other transitions (live → reconnecting, reconnecting → live,
    // reconnecting → offline-but-debounced-into-reconnecting) are
    // intentionally silent per ADR-009. The aria-live region keeps its
    // previous content; aria-atomic + identical text is a no-op for
    // assistive tech.
  }, [connectionState, lastReconcileMs]);

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="offline-aria-live"
      className="sr-only"
    >
      {message}
    </div>
  );
}
