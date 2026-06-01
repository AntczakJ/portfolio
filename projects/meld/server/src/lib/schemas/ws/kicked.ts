import { z } from 'zod';

/**
 * `control.kicked-for-name-collision` control frame schema (ADR-004 —
 * Task 1.X-control schema; v2 emit).
 *
 * RESERVED for v2 — the schema lands in v1 so the `frame.ts`
 * discriminated union compiles against the full v1 vocabulary, but
 * v1 server code never emits this kind.
 *
 * v2 emit path (better-auth activation):
 *
 *   When auth lights up (ADR-001 v2), users can pick an explicit
 *   display name. If two sessions claim the same name on the same
 *   board, the server emits this frame to the earlier session
 *   IMMEDIATELY BEFORE closing it (the later session keeps the name
 *   because the claim is "last write wins" for the v2 UX). The
 *   `replacedBySessionId` field lets the kicked client tell the
 *   user "you were replaced by [other session]" rather than just
 *   silently dropping.
 *
 * In v1 the schema is intentional dead schema (AGENT_NOTES
 * "intentional dead code with documented reactivation path") — same
 * pattern as the `'heartbeat'` and `'settings.update'` stubs.
 * Do NOT delete it under a "remove dead code" review pass.
 */

export const wsKickedFrameSchema = z.object({
  kind: z.literal('control.kicked-for-name-collision'),
  replacedBySessionId: z.string().uuid(),
});

export type WSControlKickedFramePayload = z.infer<typeof wsKickedFrameSchema>;
