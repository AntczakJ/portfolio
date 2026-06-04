import type { SseEvent } from '../lib/schemas/events';

/**
 * The event types the PUBLIC stream is allowed to carry (ADR-003).
 *
 * The public status page exposes STRICTLY LESS than the dashboard: only
 * coarse-grained status/incident transitions, never raw `check.result`
 * (response times — operational detail) and never `alert.fired` (the owner's
 * private alerting). `heartbeat` is added by the route itself (it is not a
 * domain event on the channel), so it is not in this allow-set.
 */
const PUBLIC_ALLOWED_TYPES = new Set<SseEvent['type']>([
  'status.change',
  'incident.open',
  'incident.close',
]);

/**
 * Extract the `monitorId` an event concerns, if any. `heartbeat` has none
 * (it is route-injected, not channel-sourced) — returns null so the public
 * filter rejects it from the domain path.
 */
function eventMonitorId(event: SseEvent): string | null {
  switch (event.type) {
    case 'check.result':
    case 'status.change':
    case 'incident.open':
    case 'incident.close':
    case 'alert.fired':
      return event.payload.monitorId;
    case 'heartbeat':
      return null;
  }
}

/**
 * Redact + re-scope a single envelope for a public status page, or drop it.
 *
 * Returns the rescoped envelope (`scope = public:<pageId>`) iff the event is:
 *   - an allowed public type (`status.change` / `incident.open` / `incident.close`),
 *     AND
 *   - about a monitor the page explicitly publishes (`monitorId ∈ allowedMonitorIds`).
 *
 * Otherwise returns `null` — the event NEVER reaches the public stream. This is
 * the single chokepoint both the live path and the `Last-Event-ID` replay path
 * run through, so `check.result` (raw response times) and `alert.fired` (the
 * owner's alerting) cannot leak to an unauthenticated viewer by any code path.
 *
 * Pure (no IO) so the redaction guarantee is exhaustively unit-testable — the
 * test asserts `check.result` / `alert.fired` are always dropped regardless of
 * the monitor set.
 */
export function redactForPublic(
  event: SseEvent,
  pageId: string,
  allowedMonitorIds: ReadonlySet<string>,
): SseEvent | null {
  if (!PUBLIC_ALLOWED_TYPES.has(event.type)) return null;

  const monitorId = eventMonitorId(event);
  if (monitorId === null || !allowedMonitorIds.has(monitorId)) return null;

  // Re-scope to the public page. The id/ts/type/payload are preserved (the
  // payloads of the allowed types carry no private response-time data — only
  // a status transition or an incident's coarse shape), only the routing scope
  // changes from the source `dashboard:<userId>` to `public:<pageId>`.
  return { ...event, scope: `public:${pageId}` };
}
