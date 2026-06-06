import {
  CircleDot,
  CircleParking,
  MoveRight,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';

import type { VehicleStatus } from '@/lib/fleet/types';

/**
 * The status presentation contract (Task 5.1 / accessibility).
 *
 * Vehicle status is NEVER rendered colour-alone (CLAUDE.md a11y bar, the
 * AGENT_NOTES "status is never colour-alone" cross-cutting concern). Every
 * status carries a human LABEL, an ICON, and an accessible name in ADDITION to
 * its colour token — so colour is reinforcement, never the sole channel. This
 * descriptor is the single source the fleet table, the detail panel, and the
 * events feed all read, so the three surfaces agree on every status.
 *
 * The token class names map the status enum (`en_route`) to the CSS variable
 * keys (`enroute`) defined in `globals.css` (`--color-status-enroute` etc.),
 * which Tailwind v4 exposes as `text-status-enroute` / `bg-status-enroute`.
 */

export interface StatusDescriptor {
  status: VehicleStatus;
  /** Human-legible label, e.g. "En route". The visible text channel. */
  label: string;
  /** The status icon (reinforces the label; never the sole channel either). */
  icon: LucideIcon;
  /** Tailwind text-colour utility for the dot/icon — colour reinforcement. */
  textClass: string;
  /** Tailwind background-colour utility for the status dot. */
  dotClass: string;
  /** Screen-reader description of what the status means. */
  description: string;
}

const DESCRIPTORS: Record<VehicleStatus, StatusDescriptor> = {
  en_route: {
    status: 'en_route',
    label: 'En route',
    icon: MoveRight,
    textClass: 'text-status-enroute',
    dotClass: 'bg-status-enroute',
    description: 'Moving along its route',
  },
  at_stop: {
    status: 'at_stop',
    label: 'At stop',
    icon: CircleParking,
    textClass: 'text-status-atstop',
    dotClass: 'bg-status-atstop',
    description: 'Dwelling at a stop',
  },
  idle: {
    status: 'idle',
    label: 'Idle',
    icon: CircleDot,
    textClass: 'text-status-idle',
    dotClass: 'bg-status-idle',
    description: 'Parked with no active route',
  },
  returning: {
    status: 'returning',
    label: 'Returning',
    icon: RotateCcw,
    textClass: 'text-status-returning',
    dotClass: 'bg-status-returning',
    description: 'Returning to its depot',
  },
};

/** Resolve the presentation descriptor for a vehicle status. */
export function statusDescriptor(status: VehicleStatus): StatusDescriptor {
  return DESCRIPTORS[status];
}
