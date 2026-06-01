import { z } from 'zod';

/**
 * `heartbeat` control frame schema (ADR-004 — Task 1.X-control schema;
 * v1.1 emit).
 *
 * RESERVED for v1.1 — the schema lands in v1 so the `frame.ts`
 * discriminated union compiles against the full v1 vocabulary, but
 * v1 server code never emits this kind and the v1 client never
 * parses it.
 *
 * v1 heartbeat policy (ADR-004 verbatim):
 *
 *   Protocol-level WebSocket ping ONLY in v1. Hocuspocus delegates to
 *   the `ws` library which surfaces `pingInterval` (configured at
 *   `timeout: 30_000 ms` on the Hocuspocus config — see
 *   `meld-server/src/lib/ws/server.ts`). The browser receives ping
 *   frames at the protocol layer (transparent to JavaScript) and the
 *   platform responds automatically. No application-level heartbeat
 *   is needed for the v1 demo path.
 *
 * v1.1 reactivation trigger:
 *
 *   If the deployed demo on Fly.io / Railway exposes a load-balancer
 *   idle timeout that eats protocol pings (some intermediaries strip
 *   them under cross-region routing), v1.1 lights up this kind on a
 *   25 s cadence (under the typical 60 s idle-timeout floor). When
 *   the path lights up the field set may extend (server-clock,
 *   sequence number, etc.); the v1.1 ADR pins the final shape. v1
 *   ships the minimal `{ kind, serverTsMs }` so the reserved schema
 *   exists in the union.
 */

export const wsHeartbeatFrameSchema = z.object({
  kind: z.literal('heartbeat'),
  serverTsMs: z.number().int().nonnegative(),
});

export type WSHeartbeatFramePayload = z.infer<typeof wsHeartbeatFrameSchema>;
