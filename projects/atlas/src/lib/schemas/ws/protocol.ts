/**
 * WebSocket protocol constants (ADR-003).
 *
 * The contract is versioned: the `snapshot` frame carries `protocolVersion` so
 * a client can detect a mismatch, and so a future binary tick can be added
 * behind negotiation without breaking the JSON path. Bump on any
 * backwards-incompatible frame change.
 */
export const PROTOCOL_VERSION = 1;

/** Server -> client frame discriminators. */
export const SERVER_FRAME_TYPES = ['snapshot', 'tick', 'event', 'heartbeat'] as const;
export type ServerFrameType = (typeof SERVER_FRAME_TYPES)[number];

/** Client -> server frame discriminators. */
export const CLIENT_FRAME_TYPES = [
  'subscribe',
  'unsubscribe',
  'snapshot.request',
  'sim.control',
] as const;
export type ClientFrameType = (typeof CLIENT_FRAME_TYPES)[number];

/** Heartbeat cadence (ADR-003): one app-level heartbeat every 20 s, under the
 * Fly edge ~60 s idle timeout. The client treats ~2 missed beats as dead. */
export const HEARTBEAT_INTERVAL_MS = 20_000;
