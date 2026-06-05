'use client';

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { useWorkerAvailability } from '@/lib/stores/stream-store';

/**
 * Worker-offline indicator (ADR-004).
 *
 * When the Rust aggregation worker drops (crash / SIGTERM / handshake
 * timeout) the server broadcasts `control.worker_unavailable`; the stream
 * store flips `workerAvailability` to `'unavailable'`. In that window the
 * footprint cell stream has PAUSED — but ticks keep flowing on the direct
 * Binance broadcast, so the app is fine, only the chart is frozen. Without
 * a signal that reads as a silent bug ("why did the footprint stop?").
 *
 * This renders a small, CALM indicator — same restrained vocabulary as the
 * `ApiStatus` / WS-state pip in the status bar — saying the cells are
 * paused while the worker restarts. It clears the moment
 * `control.worker_ready` arrives and the store flips back to `'available'`.
 *
 * ACCESSIBILITY
 *   - `aria-live="polite"` (NOT assertive): this is informational, not an
 *     error. It must not interrupt a screen-reader user mid-sentence.
 *   - The icon is `aria-hidden`; the text carries the meaning.
 *
 * CALM, NOT ALARMING
 *   - Uses the muted foreground + a warning-toned pip, never the danger
 *     red. No flashing, no pulsing beyond the reduced-motion-safe spinner
 *     (which the global `prefers-reduced-motion` rule freezes).
 *   - Renders NOTHING while the worker is available, so it never adds
 *     visual noise in the steady state.
 */
export function WorkerStatus(): ReactNode {
  const availability = useWorkerAvailability();

  return (
    // The live region is ALWAYS in the DOM (empty when available) so the
    // polite announcement fires on the content change rather than on a
    // node insertion — a region added to the tree at the same time as its
    // text is not reliably announced.
    <div
      aria-live="polite"
      className="inline-flex items-center"
      data-worker-status={availability}
    >
      {availability === 'unavailable' ? (
        <span className="inline-flex items-center gap-1.5 text-(--color-warning)">
          <Loader2
            aria-hidden="true"
            className="size-3 animate-spin motion-reduce:animate-none"
          />
          <span>Cells paused — worker restarting</span>
        </span>
      ) : null}
    </div>
  );
}
