'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { PanelShell } from '@/components/panels/panel-shell';
import { cn } from '@/lib/cn';
import { eventCopy } from '@/lib/fleet/event-copy';
import { formatRelativeTime } from '@/lib/fleet/format';
import { useEventsStore } from '@/lib/store/events-store';
import { useTelemetryStore } from '@/lib/store/telemetry-store';

/**
 * Live events feed (Task 5.3).
 *
 * Geofence enter/exit + status changes materialise at the TOP as the fleet
 * crosses zone boundaries — newest first, Motion `AnimatePresence` row enter
 * (reduced-motion-safe: no slide/height animation under reduced motion, the row
 * just appears). The geofence beat is wired three ways across the app: the zone
 * pulses (the map controller, already wired in 4.3), the event row lands HERE,
 * and the vehicle status flips (the next tick's telemetry, the fleet panel +
 * detail panel re-render).
 *
 * Accessibility: a SEPARATE `aria-live="polite"` region announces only the
 * LATEST event, throttled/coalesced so a burst of crossings does not flood a
 * screen reader. The visible list is `aria-hidden` from the live announcement
 * (it would double-announce); the polite region carries the single line.
 */

/** Minimum gap between polite announcements (ms) — coalesces a burst. */
const ANNOUNCE_THROTTLE_MS = 1500;

export function EventsPanel(): ReactNode {
  const events = useEventsStore((s) => s.events);
  const vehicles = useTelemetryStore((s) => s.vehicles);
  const reduce = useReducedMotion();

  const [nowMs, setNowMs] = useState(() => Date.now());
  // Refresh relative timestamps once a second (low frequency, not the rAF loop).
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);

  const announcement = useThrottledAnnouncement();

  return (
    <PanelShell title="Events" meta="live" className="h-full">
      {/* The polite live region — the ONLY announced surface. Visually hidden;
          carries one coalesced line so a burst does not flood the SR. */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {events.length === 0 ? (
        <p className="text-fg-subtle text-sm leading-normal">
          Geofence enter / exit and status changes will materialise here as the
          fleet crosses zone boundaries, newest first.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" aria-hidden="true">
          <AnimatePresence initial={false}>
            {events.map((event) => {
              const label = vehicles[event.vehicleId]?.label ?? event.vehicleId;
              const copy = eventCopy(event, label);
              const Icon = copy.icon;
              return (
                <motion.li
                  key={event.id}
                  layout={!reduce}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, height: 0 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, height: 'auto' }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="border-border bg-surface-2 flex items-center gap-2 overflow-hidden rounded-md border px-2.5 py-1.5"
                >
                  <Icon className={cn('size-3.5 shrink-0', copy.accentClass)} aria-hidden="true" />
                  <span className="text-foreground truncate text-xs">{copy.text}</span>
                  <span className="text-fg-subtle ml-auto shrink-0 font-mono text-2xs tabular-nums">
                    {formatRelativeTime(event.at, nowMs)}
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </PanelShell>
  );
}

/**
 * Coalesce the events-store announcements into a polite-region string that
 * changes at most once per throttle window. A burst of geofence crossings then
 * announces the latest, not all of them, so the SR is informed but not flooded.
 */
function useThrottledAnnouncement(): string {
  const lastAnnounced = useEventsStore((s) => s.lastAnnounced);
  const vehicles = useTelemetryStore((s) => s.vehicles);
  const [message, setMessage] = useState('');
  const lastEmittedAt = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastAnnounced) return;
    const label = vehicles[lastAnnounced.vehicleId]?.label ?? lastAnnounced.vehicleId;
    const text = eventCopy(lastAnnounced, label).text;

    const now = Date.now();
    const elapsed = now - lastEmittedAt.current;
    const emit = (): void => {
      lastEmittedAt.current = Date.now();
      setMessage(text);
    };

    if (elapsed >= ANNOUNCE_THROTTLE_MS) {
      emit();
    } else {
      // Schedule the latest pending event at the end of the window (coalesce).
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = setTimeout(emit, ANNOUNCE_THROTTLE_MS - elapsed);
    }

    return () => {
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current);
        pendingTimer.current = null;
      }
    };
    // Re-run when the announced event identity changes.
  }, [lastAnnounced, vehicles]);

  return message;
}
