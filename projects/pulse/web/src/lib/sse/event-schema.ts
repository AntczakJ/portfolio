import '@/lib/zod-config';

import { z } from 'zod';

import type { SseEvent } from 'pulse-server/events';

/**
 * Client-side, defensive SSE envelope validator.
 *
 * The AUTHORITATIVE runtime contract is the server's Zod schema in
 * `pulse-server/events` (ADR-003) — the server validates every event it
 * relays at the boundary, so anything that reaches the browser is already
 * well-formed. We import the inferred TYPE from there (types-only, so the
 * server's Zod-v3 runtime is erased), and re-state a CHEAP, mirror schema
 * here with the web's own Zod v4 to validate defensively on the client.
 *
 * Why re-state rather than import the runtime schema:
 *   - The server pins Zod v3; the web is on Zod v4. Importing the runtime
 *     schema would drag a second Zod version into the browser bundle and
 *     couple the web to the server's runtime.
 *   - The client check is intentionally cheaper than the server's: it only
 *     needs to guarantee the envelope shape before we narrow on `type` and
 *     touch `payload`, so a malformed frame (a future event we do not know,
 *     a truncated JSON body) is dropped rather than crashing a render.
 *
 * The `satisfies` below pins this mirror to the contract type — if the
 * server reshapes an envelope, the inferred type drifts and this file fails
 * to compile, which is the drift guard.
 */

const monitorStatus = z.enum(['up', 'degraded', 'down']);
const incidentSeverity = z.enum(['degraded', 'down']);
const alertTransition = z.enum(['open', 'close']);

const envelopeBase = {
  id: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
  scope: z.string(),
};

export const clientSseEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...envelopeBase,
    type: z.literal('check.result'),
    payload: z.object({
      monitorId: z.string(),
      status: monitorStatus,
      statusCode: z.number().int().nullable(),
      responseTimeMs: z.number().int().nonnegative().nullable(),
      checkedAt: z.string(),
    }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('status.change'),
    payload: z.object({
      monitorId: z.string(),
      from: monitorStatus,
      to: monitorStatus,
      at: z.string(),
    }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('incident.open'),
    payload: z.object({
      incidentId: z.string(),
      monitorId: z.string(),
      severity: incidentSeverity,
      startedAt: z.string(),
      cause: z.string(),
    }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('incident.close'),
    payload: z.object({
      incidentId: z.string(),
      monitorId: z.string(),
      startedAt: z.string(),
      resolvedAt: z.string(),
      durationMs: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('alert.fired'),
    payload: z.object({
      incidentId: z.string(),
      monitorId: z.string(),
      channelType: z.enum(['webhook', 'email']),
      transition: alertTransition,
      deliveredAt: z.string(),
      status: z.enum(['sent', 'failed']),
    }),
  }),
  z.object({
    ...envelopeBase,
    type: z.literal('heartbeat'),
    payload: z.object({ ts: z.number().int().nonnegative() }),
  }),
]);

/**
 * Parse a raw `MessageEvent.data` string into a typed `SseEvent`, returning
 * `null` for anything malformed (bad JSON, unknown event type, a payload
 * that does not match). Never throws — a bad frame must not break the board.
 */
export function parseSseEvent(raw: string): SseEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = clientSseEventSchema.safeParse(json);
  if (!result.success) {
    return null;
  }
  // The mirror is pinned to the contract via the type annotation below; the
  // cast is the single, audited boundary where the validated shape becomes
  // the contract type.
  return result.data satisfies SseEvent;
}
