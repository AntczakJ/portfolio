/**
 * Status semantics — the single source of truth for the load-bearing
 * up / degraded / down / unknown vocabulary that the whole product hinges
 * on (the live status board, the monitor cards, the public status page,
 * the incident rows).
 *
 * The four statuses and their fixed color mapping are pinned in
 * `globals.css` as first-class tokens (`--color-status-*`). This module
 * binds each status to:
 *   - a human LABEL (status is never color-alone — every dot ships this
 *     text label and an accessible name; AGENT_NOTES accessibility gate),
 *   - the Tailwind utility classes the sovereign tokens generate, split
 *     into the DOT/fill role (3:1 graphical) and the TEXT/ink role
 *     (4.5:1 AA), plus a faint tinted SURFACE for badges/rows.
 *
 * Phase 3.3 (Task 3.3) GATE CLEARED: the live `MonitorStatus` vocabulary
 * (`up` | `degraded` | `down`) now comes from the shared backend contract
 * `pulse-server/events` (Task 1.4) via a TYPES-ONLY import, so the FE/BE
 * status vocabulary cannot drift (conventions § 5). The Zod runtime is
 * erased on the web side (verbatimModuleSyntax), mirroring meld-web's
 * `import type { App } from 'meld-server'` pattern.
 *
 * The board adds ONE display-only status the wire never carries: `unknown`
 * — the ADR-004 idle / never-checked / stale-gap state. A monitor that has
 * not yet produced a `check.result` (or whose data is stale) paints
 * `unknown` until the first real result lands. We model this as
 * `DisplayStatus = MonitorStatus | 'unknown'` so the contract stays the
 * single source of truth for the live vocabulary while the UI keeps its
 * idle affordance.
 */

import type { MonitorStatus } from 'pulse-server/events';

export type { MonitorStatus };

/** The display vocabulary: the wire statuses plus the UI-only idle state. */
export type DisplayStatus = MonitorStatus | 'unknown';

export const DISPLAY_STATUSES = [
  'up',
  'degraded',
  'down',
  'unknown',
] as const satisfies readonly DisplayStatus[];

/**
 * Back-compat alias for the placeholder name the scaffold used. The board
 * and the legend iterate this; it now means "all display statuses".
 */
export const MONITOR_STATUSES = DISPLAY_STATUSES;

interface StatusToken {
  /** Human-facing label — travels with every dot for accessibility. */
  readonly label: string;
  /** The graphical DOT / fill class (>= 3:1 vs surfaces, both themes). */
  readonly dot: string;
  /** The LABEL ink class (>= 4.5:1 AA vs surfaces, both themes). */
  readonly text: string;
  /** Faint tinted surface for badges / selected rows. */
  readonly surface: string;
  /** Border to pair with the tinted surface on a badge / banner. */
  readonly border: string;
}

export const STATUS_TOKENS: Record<DisplayStatus, StatusToken> = {
  up: {
    label: 'Up',
    dot: 'bg-status-up',
    text: 'text-status-up-text',
    surface: 'bg-status-up-surface',
    border: 'border-status-up/40',
  },
  degraded: {
    label: 'Degraded',
    dot: 'bg-status-degraded',
    text: 'text-status-degraded-text',
    surface: 'bg-status-degraded-surface',
    border: 'border-status-degraded/40',
  },
  down: {
    label: 'Down',
    dot: 'bg-status-down',
    text: 'text-status-down-text',
    surface: 'bg-status-down-surface',
    border: 'border-status-down/40',
  },
  unknown: {
    label: 'Unknown',
    dot: 'bg-status-unknown',
    text: 'text-status-unknown-text',
    surface: 'bg-status-unknown-surface',
    border: 'border-status-unknown/40',
  },
};

/**
 * Safe accessor — falls back to the neutral `unknown` token for any value
 * outside the display vocabulary (a defensive guard for an unexpected runtime
 * status the types do not cover). `Object.hasOwn` keeps the fallback a real,
 * type-honest branch rather than an unreachable `??`.
 */
export function statusToken(status: DisplayStatus): StatusToken {
  return Object.hasOwn(STATUS_TOKENS, status)
    ? STATUS_TOKENS[status]
    : STATUS_TOKENS.unknown;
}
