/**
 * `control.overrun` frame parsing — ADR-010 §2, ADR-004 payload,
 * ADR-011 transport.
 *
 * The server emits a `control.overrun` control frame over Hocuspocus's
 * Stateless channel IMMEDIATELY before closing the connection with code
 * `4290` (ADR-002 backpressure). The client receives it through
 * `handleStatelessControlMessage` → `onUnknownControlFrame`. ADR-010
 * directs that route to a real handler (replacing the dev-only warn for
 * this kind) that surfaces a calm, recoverable notice on the EXISTING
 * `<ConnectionBanner />` chrome and drives a disconnect + reconnect-
 * after-`retryAfterMs` cycle.
 *
 * Payload shape (ADR-004, unchanged by ADR-011's transport move):
 *
 *   { kind: 'control.overrun', reason, closeCode: 4290, retryAfterMs }
 *
 * where `reason` discriminates `queue.overflow | rate.exceeded |
 * message.too-large`. We parse defensively — a malformed overrun frame
 * must not crash the board; it falls back to a default `retryAfterMs`.
 */

import { z } from 'zod';

/** ADR-004 overrun reason enum. */
export const OVERRUN_REASONS = [
  'queue.overflow',
  'rate.exceeded',
  'message.too-large',
] as const;

export type OverrunReason = (typeof OVERRUN_REASONS)[number];

/**
 * Default cool-off when the server omits / sends a malformed
 * `retryAfterMs`. Matches ADR-004's example value (1500 ms) and the
 * ADR-009 disconnect-debounce window so the two recoverable-disconnect
 * paths feel consistent.
 */
export const DEFAULT_OVERRUN_RETRY_MS = 1500;

/**
 * Clamp bounds for `retryAfterMs`. A hostile / buggy server value must
 * not strand the client offline forever or hammer the socket with an
 * instant reconnect.
 */
const MIN_RETRY_MS = 250;
const MAX_RETRY_MS = 30_000;

const overrunFrameSchema = z.object({
  kind: z.literal('control.overrun'),
  // `reason` is informational for the user-facing copy; an unknown
  // value still produces a recoverable notice, so we accept any string
  // and narrow to the known enum where possible.
  reason: z.string().optional(),
  closeCode: z.number().int().optional(),
  // `retryAfterMs` is accepted as `unknown` and normalised in
  // `clampRetry` — a non-finite or out-of-range value must NOT fail the
  // whole frame (Zod's `z.number()` rejects `Infinity`/`NaN`, which
  // would drop a recoverable overrun on a single bad field). We always
  // want the recoverable notice + a safe default retry.
  retryAfterMs: z.unknown().optional(),
});

export interface OverrunFrame {
  reason: OverrunReason | 'unknown';
  retryAfterMs: number;
}

/**
 * Type-guard + parse for a control frame already known to have a
 * `kind` discriminator. Returns the normalised overrun frame when
 * `kind === 'control.overrun'`, else `null` (the frame is some other
 * control kind the caller routes elsewhere).
 *
 * Never throws.
 */
export function parseOverrunFrame(raw: unknown): OverrunFrame | null {
  const result = overrunFrameSchema.safeParse(raw);
  if (!result.success) return null;

  const { reason, retryAfterMs } = result.data;
  return {
    reason: isKnownReason(reason) ? reason : 'unknown',
    retryAfterMs: clampRetry(retryAfterMs),
  };
}

function isKnownReason(value: string | undefined): value is OverrunReason {
  return (
    value !== undefined && (OVERRUN_REASONS as readonly string[]).includes(value)
  );
}

function clampRetry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_OVERRUN_RETRY_MS;
  }
  return Math.max(MIN_RETRY_MS, Math.min(MAX_RETRY_MS, Math.floor(value)));
}
