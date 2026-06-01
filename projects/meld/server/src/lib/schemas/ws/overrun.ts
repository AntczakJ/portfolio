import { z } from 'zod';

/**
 * `control.overrun` control frame schema (ADR-004 — Task 1.X-control).
 *
 * Server emits IMMEDIATELY BEFORE the framework-level close with code
 * `4290` per ADR-002 backpressure. The frame names which boundary
 * fired so the client can surface a useful diagnostic AND respect
 * `retryAfterMs` in its `WebsocketProvider` reconnect-backoff curve
 * to avoid a reconnect storm (e.g., 50 connections all hitting
 * `rate.exceeded` at once and all reconnecting in sync).
 *
 * Reason discrimination — three v1 boundaries:
 *
 *   - `queue.overflow`  — reserved for a future framework-level
 *                         per-client send-queue overflow (ADR-002
 *                         backpressure shape — not enforced today
 *                         because Hocuspocus 4.1 does not surface
 *                         queue depth).
 *   - `rate.exceeded`   — Task 1.X-control's token-bucket extension
 *                         caught the client over the 100 msg/sec
 *                         limit (`maxRate` gap per AGENT_NOTES).
 *   - `message.too-large` — `ws` library rejected a frame larger than
 *                           `maxPayload: 1 MB`. The `ws` close
 *                           normally lands as code `1009`; we replace
 *                           that with code `4290` via the structured
 *                           close-error pattern Hocuspocus uses when
 *                           `beforeHandleMessage` throws.
 */

export const wsOverrunReasonSchema = z.enum([
  'queue.overflow',
  'rate.exceeded',
  'message.too-large',
]);

export type WSOverrunReason = z.infer<typeof wsOverrunReasonSchema>;

export const wsOverrunFrameSchema = z.object({
  kind: z.literal('control.overrun'),
  reason: wsOverrunReasonSchema,
  closeCode: z.literal(4290),
  retryAfterMs: z.number().int().nonnegative(),
});

export type WSControlOverrunFramePayload = z.infer<typeof wsOverrunFrameSchema>;
