import { z } from 'zod';

/**
 * `settings.update` control frame schema (ADR-004 — Task 1.X-control
 * schema; v1.1 emit).
 *
 * RESERVED for v1.1 — the schema lands in v1 so the `frame.ts`
 * discriminated union compiles against the full v1 vocabulary, but
 * v1 server code never emits this kind and the v1 client never
 * parses it.
 *
 * v1.1 light-up — user-chosen name / color override.
 *
 *   ADR-005 pins the v1 identity scheme as deterministic-from-cookie
 *   emoji + per-board color. v1.1 admits a user-chosen override: the
 *   client emits a `settings.update` TEXT frame with the new label /
 *   color, the server forwards it through the awareness layer so
 *   peers see the change without a round trip through Postgres.
 *
 * v1 ships the schema with `payload: z.unknown()` so the discriminated
 * union compiles. The v1.1 ADR refines `payload` to a typed sub-shape
 * (`{ displayName?, colorOverride? }`). Until then, server code MUST
 * NOT trust the `payload` field's contents — the unknown type is a
 * deliberate "do not consume in v1" marker, mirroring the
 * better-auth-wired-but-inactive pattern.
 */

export const wsSettingsUpdateFrameSchema = z.object({
  kind: z.literal('settings.update'),
  payload: z.unknown(),
});

export type WSSettingsUpdateFramePayload = z.infer<
  typeof wsSettingsUpdateFrameSchema
>;
