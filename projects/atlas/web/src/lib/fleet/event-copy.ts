import {
  ArrowRightCircle,
  Flag,
  LogIn,
  LogOut,
  Repeat,
  type LucideIcon,
} from 'lucide-react';

import type {
  GeofenceEventPayload,
  SimEvent,
  StatusChangeEventPayload,
  StopEventPayload,
} from 'atlas-shared/schemas';

import { statusDescriptor } from '@/lib/fleet/status-descriptor';

/**
 * Event-row copy (Task 5.3).
 *
 * Turns a `SimEvent` into a human feed line — "Unit 7 entered Aliados Delivery",
 * "Unit 3 arrived at Pickup", "Unit 5 went en route". The geofence beat copy is
 * the load-bearing one ("entered <zone>"). Vehicle labels come from the caller
 * (the telemetry store's vehicle definitions); the zone/stop names ride in the
 * event payload, so this needs only the vehicle label resolver.
 *
 * Status colour is reinforcement only — the row always carries the text line +
 * an icon (status is never colour-alone).
 */

export interface EventCopy {
  /** The feed line, e.g. "Unit 7 entered Aliados Delivery". */
  text: string;
  /** Icon reinforcing the event kind. */
  icon: LucideIcon;
  /** Accent text-colour token for the icon — reinforcement, never sole channel. */
  accentClass: string;
}

function payloadHasZone(payload: SimEvent['payload']): payload is GeofenceEventPayload {
  return 'zoneName' in payload;
}

function payloadHasStop(payload: SimEvent['payload']): payload is StopEventPayload {
  return 'stopName' in payload;
}

function payloadHasStatus(payload: SimEvent['payload']): payload is StatusChangeEventPayload {
  return 'to' in payload;
}

/** Build the feed copy for an event, resolving the vehicle's display label. */
export function eventCopy(event: SimEvent, vehicleLabel: string): EventCopy {
  switch (event.type) {
    case 'geofence.enter': {
      const zone = payloadHasZone(event.payload) ? event.payload.zoneName : 'a zone';
      return {
        text: `${vehicleLabel} entered ${zone}`,
        icon: LogIn,
        accentClass: 'text-status-enroute',
      };
    }
    case 'geofence.exit': {
      const zone = payloadHasZone(event.payload) ? event.payload.zoneName : 'a zone';
      return {
        text: `${vehicleLabel} left ${zone}`,
        icon: LogOut,
        accentClass: 'text-fg-muted',
      };
    }
    case 'status.change': {
      if (payloadHasStatus(event.payload)) {
        const to = statusDescriptor(event.payload.to);
        return {
          text: `${vehicleLabel} is now ${to.label.toLowerCase()}`,
          icon: Repeat,
          accentClass: to.textClass,
        };
      }
      return { text: `${vehicleLabel} changed status`, icon: Repeat, accentClass: 'text-fg-muted' };
    }
    case 'arrived': {
      const stop = payloadHasStop(event.payload) ? event.payload.stopName : 'a stop';
      return {
        text: `${vehicleLabel} arrived at ${stop}`,
        icon: Flag,
        accentClass: 'text-status-atstop',
      };
    }
    case 'departed': {
      const stop = payloadHasStop(event.payload) ? event.payload.stopName : 'a stop';
      return {
        text: `${vehicleLabel} departed ${stop}`,
        icon: ArrowRightCircle,
        accentClass: 'text-status-enroute',
      };
    }
  }
}
