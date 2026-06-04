'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { env } from '@/lib/env';
import { monitorsQueryKey } from '@/lib/api/monitors';
import { parseSseEvent } from '@/lib/sse/event-schema';
import { useLiveBoard } from '@/lib/store/live-store';
import { SSE_EVENT_NAMES } from '@/lib/sse/event-names';
import type {
  AlertFiredEvent,
  IncidentCloseEvent,
  IncidentOpenEvent,
} from 'pulse-server/events';

/**
 * The live-board SSE client (Task 3.3 / ADR-003).
 *
 * Opens ONE long-lived `EventSource` on `${sseUrl}/api/stream` with
 * `withCredentials` (the cookie path Phase 6 auth uses; today the server
 * resolves the seeded demo owner). The success criterion is exactly this:
 * DevTools shows ONE `text/event-stream` connection, not a polling loop.
 *
 * It addEventListener's the named events from the ADR-003 vocabulary,
 * validates each defensively against the mirror schema, and applies it to
 * the Zustand live store. On `open` (initial connect AND every auto-reconnect)
 * it REFETCHES `GET /monitors` via TanStack Query to reconcile any events
 * missed during a gap — the ADR-003 "Pub/Sub is fire-and-forget; reconcile
 * via REST on reconnect" model. The browser auto-reconnects and auto-sends
 * `Last-Event-ID`, so the server replays its short ring buffer for free.
 *
 * Connection state is surfaced calmly: `live` (open), `connecting` (initial),
 * `reconnecting` (the browser is retrying after a drop). EventSource has no
 * "permanently failed" notion at our scale — a dropped link cycles through
 * `reconnecting` until it recovers.
 *
 * `onAlertFired` is an optional sink for the toast layer (Phase 5); the
 * board store does not model alerts.
 */

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

interface UseLiveBoardOptions {
  /** Called when an `alert.fired` event lands (the toast hook, Phase 5). */
  onAlertFired?: (event: AlertFiredEvent) => void;
  /**
   * Called the moment an `incident.open` lands — the coordinated wow beat. The
   * board store already flips the card/summary/strip from the same event; this
   * sink lets the toast layer fire IN THE SAME TICK (C-1), instead of waiting
   * for the later `alert.fired`.
   */
  onIncidentOpen?: (event: IncidentOpenEvent) => void;
  /** Called when an `incident.close` lands (the recovery toast, C-1). */
  onIncidentClose?: (event: IncidentCloseEvent) => void;
  /** Disable the connection (e.g. SSR guard / tests). Default enabled. */
  enabled?: boolean;
}

export function useLiveBoardConnection(
  options: UseLiveBoardOptions = {},
): ConnectionState {
  const { onAlertFired, onIncidentOpen, onIncidentClose, enabled = true } =
    options;
  const applyEvent = useLiveBoard((s) => s.applyEvent);
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>('connecting');

  // Keep the latest sinks in refs so re-renders do not re-open the EventSource
  // (the connection lifecycle must not churn).
  const onAlertFiredRef = useRef(onAlertFired);
  onAlertFiredRef.current = onAlertFired;
  const onIncidentOpenRef = useRef(onIncidentOpen);
  onIncidentOpenRef.current = onIncidentOpen;
  const onIncidentCloseRef = useRef(onIncidentClose);
  onIncidentCloseRef.current = onIncidentClose;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const url = `${env.sseUrl}/api/stream`;
    const source = new EventSource(url, { withCredentials: true });
    // Was the connection ever open? Distinguishes the initial "connecting"
    // from a post-drop "reconnecting" when `error` fires.
    let everOpen = false;

    source.onopen = () => {
      everOpen = true;
      setConnection('live');
      // Reconcile any events missed before/while connecting (ADR-003).
      void queryClient.invalidateQueries({ queryKey: monitorsQueryKey });
    };

    source.onerror = () => {
      // EventSource auto-reconnects; we surface the state calmly. If it was
      // open before, we are reconnecting; otherwise still connecting.
      setConnection(everOpen ? 'reconnecting' : 'connecting');
    };

    const handlers = SSE_EVENT_NAMES.map((name) => {
      const listener = (event: MessageEvent<string>) => {
        const parsed = parseSseEvent(event.data);
        if (!parsed) {
          return; // malformed / unknown frame — drop it
        }
        if (parsed.type === 'alert.fired') {
          onAlertFiredRef.current?.(parsed.payload);
          return;
        }
        // The incident events drive BOTH the board store (card/summary/strip
        // fan-out) AND the toast sink, from the same frame — so the dramatic
        // beat lands as one coordinated transition (C-1).
        if (parsed.type === 'incident.open') {
          applyEvent(parsed);
          onIncidentOpenRef.current?.(parsed.payload);
          return;
        }
        if (parsed.type === 'incident.close') {
          applyEvent(parsed);
          onIncidentCloseRef.current?.(parsed.payload);
          return;
        }
        applyEvent(parsed);
      };
      source.addEventListener(name, listener as EventListener);
      return { name, listener };
    });

    return () => {
      for (const { name, listener } of handlers) {
        source.removeEventListener(name, listener as EventListener);
      }
      source.close();
    };
  }, [applyEvent, queryClient, enabled]);

  return connection;
}
