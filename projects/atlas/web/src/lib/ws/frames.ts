/**
 * WS frame types + structural narrowing for the web client (Task 4.2).
 *
 * Frame TYPES are imported TYPE-ONLY from `atlas-shared/schemas/ws` — the FE/BE
 * contract (ADR-003). verbatimModuleSyntax erases the Zod runtime from the
 * browser bundle (the web validates nothing with Zod; the frames come from our
 * own trusted gateway). Inbound frames are narrowed STRUCTURALLY on `t` here —
 * cheap, allocation-free, and Zod-free — which is sufficient for a trusted
 * same-origin server stream. A frame that does not match the union is ignored.
 *
 * Outbound client frames are constructed against the typed union so a typo is a
 * compile error.
 */

import type {
  ClientFrame,
  EventFrame,
  HeartbeatFrame,
  ServerFrame,
  SnapshotFrame,
  TickFrame,
} from 'atlas-shared/schemas/ws';

export type {
  ClientFrame,
  EventFrame,
  HeartbeatFrame,
  ServerFrame,
  SnapshotFrame,
  TickFrame,
};

/** The four server frame discriminators (must mirror the shared contract). */
const SERVER_FRAME_TYPES = ['snapshot', 'tick', 'event', 'heartbeat'] as const;

/**
 * Parse + structurally narrow an inbound text frame to a `ServerFrame`, or
 * `null` if it is not JSON, not an object, or not a known server frame. No Zod
 * — a trusted same-origin stream is narrowed on `t` + the load-bearing fields
 * the client reads.
 */
export function parseServerFrame(raw: string): ServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const t = obj.t;
  if (typeof t !== 'string' || !(SERVER_FRAME_TYPES as readonly string[]).includes(t)) {
    return null;
  }
  if (typeof obj.seq !== 'number') return null;

  // The discriminator + seq are present and valid; trust the gateway for the
  // payload shape (it self-checks outbound frames against the schema in dev).
  return parsed as ServerFrame;
}

/** Serialise a client control frame for `socket.send`. */
export function serializeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}
