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

/**
 * Hard upper bound on a `sim.control` `seek` target tick (ADR-002).
 *
 * SECURITY (the one named input surface, AGENT_NOTES "Security posture"):
 * `seek` re-folds the PURE reducer from the baseline to the target tick — a
 * SYNCHRONOUS loop on the single-threaded event loop. Without a cap, one inbound
 * frame `{t:'sim.control',action:'seek',tick:1e9}` would fold a billion times and
 * freeze the engine + every connected client (an unauthenticated event-loop DoS;
 * the per-connection rate limiter does not help — one frame is enough).
 *
 * The cap is enforced defence-in-depth (the same pattern as the `setSpeed`
 * clamp): `.max(MAX_SEEK_TICK)` at the schema boundary AND `Math.min(...)` in the
 * engine/gateway, so the bound holds even if the schema is bypassed.
 *
 * Value: 3_600 ticks = 1 h of authoritative 1 Hz sim time. This is deliberately
 * TIGHT: the longest Porto route is traversed in a few hundred ticks, so 1 h is
 * already far beyond any demo replay horizon, AND it keeps even the MAXIMUM fold
 * fast (~0.25 s synchronous over the small fleet) — a generous cap (e.g. 24 h /
 * 86_400) would let a single max-seek frame block the event loop for ~10 s, a
 * milder DoS in its own right. The cap stays tight so even the worst case is
 * cheap.
 */
export const MAX_SEEK_TICK = 3_600;
