import { create } from 'zustand';

import type { SimEvent } from 'atlas-shared/schemas';

/**
 * Live events store (Task 5.3 data layer).
 *
 * Fed from the SAME single WebSocket via `use-live-telemetry.ts`'s `onEvent`
 * callback (no second socket). Holds a BOUNDED, newest-first ring of simulation
 * events (geofence enter/exit, status changes, arrived/departed) that backs the
 * events feed and the per-vehicle "recent events" in the detail panel.
 *
 * It is React state (low frequency — a geofence beat fires every few seconds,
 * not per frame), so it is fine in Zustand. The feed component renders from it;
 * the rAF/interp surface never touches it.
 *
 * The aria-live announcement is COALESCED here (not in the component) so a burst
 * of events does not flood a screen reader: only the latest announceable event
 * is exposed, with a monotonic counter the feed throttles its polite region on.
 */

/** How many events to keep — the feed + detail "recent" both read from this. */
const MAX_EVENTS = 60;

interface EventsState {
  /** Newest-first bounded list of events. */
  events: SimEvent[];
  /**
   * The most recent announceable event + a monotonic id. The feed mirrors this
   * into an `aria-live="polite"` region on a throttle so a burst coalesces into
   * one announcement rather than flooding the SR.
   */
  lastAnnounced: SimEvent | null;
  announceSeq: number;
  /** Append one event (newest first), bounding the list. */
  pushEvent: (event: SimEvent) => void;
}

export const useEventsStore = create<EventsState>((set) => ({
  events: [],
  lastAnnounced: null,
  announceSeq: 0,

  pushEvent: (event) => {
    set((state) => {
      // Drop an exact duplicate id (a reconnect snapshot replay safety net).
      if (state.events.some((e) => e.id === event.id)) return state;
      const events = [event, ...state.events].slice(0, MAX_EVENTS);
      return {
        events,
        lastAnnounced: event,
        announceSeq: state.announceSeq + 1,
      };
    });
  },
}));

/** Select the recent events for one vehicle (detail panel). */
export function selectVehicleEvents(
  events: readonly SimEvent[],
  vehicleId: string,
  limit = 6,
): SimEvent[] {
  const out: SimEvent[] = [];
  for (const e of events) {
    if (e.vehicleId === vehicleId) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}
