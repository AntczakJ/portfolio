import { z } from 'zod';

/**
 * Control payloads — out-of-band lifecycle frames on the `control`
 * topic. The kind discriminator on the envelope identifies which
 * control frame is being received; this module declares the
 * per-kind payload shapes the browser routes on.
 *
 * v1 ships four control kinds: `control.overrun` (sent right before
 * the server force-disconnects on backpressure overrun per ADR-006 §
 * Backpressure), `control.heartbeat` (periodic server-side liveness
 * ping so the browser can detect stale connections without waiting for
 * a tick frame), and the worker-lifecycle pair `control.worker_ready`
 * / `control.worker_unavailable` (Task 1.5c supervision plumbing per
 * ADR-004 — broadcast to every subscribed client when the Rust
 * aggregation worker comes up / goes down, so the browser can show a
 * "worker offline" indicator instead of silently freezing the
 * footprint while ticks keep flowing).
 *
 * Other control kinds reserved by ADR-006 (`replay_complete`, `error`)
 * ARE NOT shipped in v1. They land alongside the tasks that actually
 * need them (`replay_complete` ships with Task 3.6 replay mode; `error`
 * ships with the first endpoint that needs a structured error path).
 * Each addition is one more variant in the envelope's discriminated
 * union — no protocol bump.
 */

/**
 * `control.overrun` — sent right before the server closes the WS
 * with `CloseEvent.code = 4290` because the per-client send queue
 * exceeded the 256 KB / 2 s circuit-breaker threshold (ADR-006).
 *
 * The browser uses `reason` to decide reconnect behaviour:
 *   - `'queue.overflow'`  → server-side burst overran our send
 *                            queue (the client is fine). Reconnect
 *                            immediately, fresh snapshot restores
 *                            state.
 *   - `'memory.budget'`   → server-side enqueued bytes outgrew the
 *                            memory budget because THIS client is
 *                            consuming slowly (backgrounded tab,
 *                            slow device). Reconnect with a longer
 *                            backoff floor so we do not immediately
 *                            re-trip.
 *
 * Field map:
 *  - `reason`         — Discriminator above.
 *  - `droppedFrames`  — Total tick frames the server dropped on
 *                       this client's behalf before the circuit
 *                       breaker tripped. Non-negative int. Lets the
 *                       browser display "you missed ~N frames"
 *                       diagnostics if it wants to surface them.
 *  - `lastTickTsMs`   — `tsMs` of the most recent tick the server
 *                       successfully sent before the close. Positive
 *                       int. Used by the browser as a hint for
 *                       whether to bridge a visible tape-strip gap
 *                       with a "reconnected at HH:MM:SS" marker.
 */
export const wsControlOverrunPayloadSchema = z.object({
  reason: z.enum(['queue.overflow', 'memory.budget']),
  droppedFrames: z.number().int().nonnegative(),
  lastTickTsMs: z.number().int().positive(),
});

export type WSControlOverrunPayload = z.infer<
  typeof wsControlOverrunPayloadSchema
>;

/**
 * `control.heartbeat` — server-side liveness ping emitted on a
 * fixed cadence (Task 1.6b implementation detail — schema does not
 * pin the interval; expected ~5 s).
 *
 * Heartbeats matter because the live data feed is bursty by nature:
 * a quiet market produces zero ticks for minutes. Without
 * heartbeats the browser cannot tell "server is healthy, market
 * is quiet" from "TCP connection is half-open and we lost the
 * server 90 s ago". WS `Ping` / `Pong` frames at the protocol layer
 * would also work but are opaque to application code; an
 * application-layer heartbeat carries observability counters too.
 *
 * Field map:
 *  - `serverTsMs`        — Server's clock at heartbeat emit time,
 *                          ms since epoch. Positive int. Browser
 *                          can compute a rough drift estimate
 *                          (`serverTsMs - Date.now()`) but should
 *                          not treat it as a clock-sync source —
 *                          there is no round-trip half here, and
 *                          variable WS queueing inflates the gap.
 *  - `framesPerSecOut`   — Server-side observed outbound frame
 *                          rate to THIS client over the last
 *                          measurement window. Non-negative finite
 *                          f64 — non-integer because the window
 *                          may be a fractional second. Useful for
 *                          the browser to surface a "feed slow"
 *                          indicator if the rate collapses to ~0
 *                          while the heartbeat keeps firing.
 */
export const wsControlHeartbeatPayloadSchema = z.object({
  serverTsMs: z.number().int().positive(),
  framesPerSecOut: z.number().nonnegative().finite(),
});

export type WSControlHeartbeatPayload = z.infer<
  typeof wsControlHeartbeatPayloadSchema
>;

/**
 * `control.worker_ready` — the Rust aggregation worker completed its
 * bridge handshake and is producing cell deltas / closes again
 * (ADR-004 § Elysia-as-supervisor). Broadcast to every subscribed
 * client by the worker pipeline on `WorkerReady`.
 *
 * Why the browser cares: between a worker crash and its respawn, ticks
 * keep flowing (the tape strip is fed by the direct Binance broadcast,
 * decoupled from the worker per ADR-005) but cell updates stop, so the
 * footprint silently freezes. The lifecycle pair lets the browser show
 * a calm "worker offline → back online" indicator rather than a chart
 * that just stops updating with no signal. The frontend consuming this
 * is a separate follow-up — the schema only guarantees the frames are
 * on the wire and validated.
 *
 * Field map:
 *  - `generation`  — Supervisor's monotonic worker-generation counter
 *                    at ready time. Non-negative int. Lets the browser
 *                    (and ops logs) correlate a ready frame with the
 *                    specific worker incarnation, and detect a missed
 *                    restart cycle (generation jumped by more than 1).
 *  - `serverTsMs`  — Server clock at emit time, ms since epoch.
 *                    Positive int. Used by the browser as the "back
 *                    online at HH:MM:SS" marker timestamp.
 */
export const wsControlWorkerReadyPayloadSchema = z.object({
  generation: z.number().int().nonnegative(),
  serverTsMs: z.number().int().positive(),
});

export type WSControlWorkerReadyPayload = z.infer<
  typeof wsControlWorkerReadyPayloadSchema
>;

/**
 * `control.worker_unavailable` — the Rust aggregation worker dropped
 * (clean shutdown, SIGTERM, crash, or handshake timeout). Broadcast to
 * every subscribed client by the worker pipeline so the footprint can
 * surface a "worker offline" state instead of silently freezing while
 * the tape strip keeps moving.
 *
 * Field map:
 *  - `reason`      — Human / machine-readable cause forwarded from the
 *                    worker's `WorkerUnavailable.reason` (e.g.
 *                    `'shutdown'`, `'sigterm'`, `'handshake.timeout'`,
 *                    `'crash'`). Non-empty string — kept open rather
 *                    than an enum because the worker owns the
 *                    vocabulary and v2 may add reasons; the browser
 *                    treats unknown reasons as a generic "offline".
 *  - `serverTsMs`  — Server clock at emit time, ms since epoch.
 *                    Positive int. "Went offline at HH:MM:SS" marker.
 */
export const wsControlWorkerUnavailablePayloadSchema = z.object({
  reason: z.string().min(1),
  serverTsMs: z.number().int().positive(),
});

export type WSControlWorkerUnavailablePayload = z.infer<
  typeof wsControlWorkerUnavailablePayloadSchema
>;
