'use client';

import { useEffect, useRef, useState } from 'react';

import type * as Y from 'yjs';

import type { ConnectionState } from '@/lib/stores/ui-store';

/**
 * `useReconciliationCount` — Phase 3.4 / ADR-009 reconcile-delta hook.
 *
 * Tracks the shape count in `doc.getMap('shapes')` continuously, and
 * on every `'offline' → 'live'` connection-state transition exposes
 * the delta between the pre-offline and post-reconnect counts. The
 * delta gates BOTH the shape-canvas crossfade in `<BoardCanvasHost />`
 * AND the aria-live announcement copy variant in
 * `<OfflineAriaLiveRegion />`:
 *
 *   - `incomingShapeCount > 0`  → "Connection restored. {N} {shape|
 *                                  shapes} synced." + crossfade.
 *   - `incomingShapeCount === 0` → "Connection restored." + no
 *                                   crossfade.
 *
 * Negative deltas (peers deleted shapes while we were offline) clamp
 * to `0` — the ADR-009 aria-live copy template covers material-
 * gained-by-the-local-tab, not shapes-disappeared. A future ADR can
 * lift this.
 *
 * Subscription strategy: a SECOND `doc.getMap('shapes').observe(...)`
 * runs in parallel with the engine's own dirty-flag observer. The
 * engine's contract is "subscribe-once" — we honor it by NOT calling
 * back into the engine's subscription; we install our own observer
 * directly on the Y.Map. Multiple observers on the same Y.Map are
 * supported by Yjs natively (observer fires fan out independently).
 * The hook's observer does NOT trigger paint — it only updates a
 * React state cell and a ref baseline; the cost is O(1) per shape
 * change.
 *
 * The hook accepts a `null` doc (mount window before the host's
 * provider lands) and returns `0`.
 */

const SHAPES_MAP_KEY = 'shapes';

export interface UseReconciliationCountOptions {
  /**
   * The live `Y.Doc`. Pass `null` while the host has not yet
   * constructed the provider; the hook returns `0` until the doc is
   * ready.
   */
  doc: Y.Doc | null;
  /**
   * The current connection state machine value (from the
   * `useConnectionStatus` hook OR the Zustand UI store mirror).
   * Drives the baseline / delta computation.
   */
  connectionState: ConnectionState;
}

/**
 * Returns the count of shapes that materialised between the start of
 * the most recent offline window and the moment we came back live.
 *
 * Reset semantics:
 *   - On every `live → offline` transition the baseline is captured
 *     and the delta resets to `0`.
 *   - On every `offline → live` transition the delta is computed
 *     and surfaced. Stays stable until the next `live → offline`.
 *   - Outside of offline windows the delta sits at `0`.
 */
export function useReconciliationCount(
  options: UseReconciliationCountOptions,
): number {
  const { doc, connectionState } = options;

  // The current shape count, refreshed by the Y.Map observer.
  const [currentCount, setCurrentCount] = useState<number>(0);
  // The most recently captured delta. Updated on `offline → live`.
  const [delta, setDelta] = useState<number>(0);

  // The shape count at the moment we entered the offline window.
  // `null` outside an offline window; a number while offline AND
  // through the offline → live transition (cleared after).
  const baselineRef = useRef<number | null>(null);
  // Previous connection state, for transition detection. The first
  // tick sees `prev === connectionState` and is a no-op.
  const prevConnectionRef = useRef<ConnectionState>(connectionState);
  // Latest count tracked in a ref so the connection-transition effect
  // reads the freshest value without taking it as a dependency (which
  // would re-run the transition effect on every shape-count tick and
  // double-count deltas).
  const currentCountRef = useRef<number>(0);

  // -----------------------------------------------------------------
  // Y.Map observer. Track shape count parallel to the engine. Re-mounts
  // on doc swap (board navigation).
  // -----------------------------------------------------------------
  useEffect(() => {
    if (doc === null) {
      setCurrentCount(0);
      currentCountRef.current = 0;
      return;
    }
    const map = doc.getMap<unknown>(SHAPES_MAP_KEY);

    const sync = (): void => {
      const size = map.size;
      currentCountRef.current = size;
      setCurrentCount(size);
    };

    // Seed: the doc may already hold shapes (server snapshot replayed
    // before the hook mounted).
    sync();

    const observer = (): void => {
      sync();
    };
    map.observe(observer);

    return () => {
      map.unobserve(observer);
    };
  }, [doc]);

  // -----------------------------------------------------------------
  // Connection transition detector. Captures baseline on offline
  // entry, computes delta on live re-entry.
  // -----------------------------------------------------------------
  useEffect(() => {
    const prev = prevConnectionRef.current;
    prevConnectionRef.current = connectionState;
    if (prev === connectionState) return;

    if (connectionState === 'offline') {
      // Capture baseline at the moment we crossed into offline. The
      // delta resets — a brand-new offline window starts now.
      baselineRef.current = currentCountRef.current;
      setDelta(0);
      return;
    }

    if (prev === 'offline' && connectionState === 'live') {
      // Came back live. Compute the delta vs the captured baseline.
      const baseline = baselineRef.current;
      if (baseline !== null) {
        const newCount = currentCountRef.current;
        const computed = newCount - baseline;
        // Clamp negatives — ADR-009 copy template covers gains only.
        setDelta(computed > 0 ? computed : 0);
        baselineRef.current = null;
      }
    }
    // Other transitions (reconnecting → offline, reconnecting → live,
    // live → reconnecting) are not aria-live emit points per ADR-009;
    // the delta sticks at its current value.
  }, [connectionState]);

  // `currentCount` is read above for the observer; eslint exhaustive
  // deps would flag it if we did not reference it. The variable is
  // intentionally read here so the linter sees it; the value is also
  // tracked through `currentCountRef` for the transition effect.
  void currentCount;

  return delta;
}
