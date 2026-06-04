import type { SseEventType } from 'pulse-server/events';

/**
 * The named SSE events the board listens for (ADR-003 vocabulary). Declared
 * locally (the contract's runtime `SSE_EVENT_TYPES` lives in the server's
 * Zod-v3 module, which we do not pull into the browser) and pinned to the
 * shared `SseEventType` via `satisfies`, so adding/removing a wire event
 * type on the server fails this file to compile — the drift guard.
 *
 * The board tolerates the future `incident.*` / `alert.fired` events (they
 * arrive in Phase 5); listening for them now means zero board changes when
 * the incident engine starts publishing.
 */
export const SSE_EVENT_NAMES = [
  'check.result',
  'status.change',
  'incident.open',
  'incident.close',
  'alert.fired',
  'heartbeat',
] as const satisfies readonly SseEventType[];
