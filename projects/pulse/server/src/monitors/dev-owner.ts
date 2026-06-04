import { eq } from 'drizzle-orm';

import type { PulseDb } from '../db/drizzle';
import { users } from '../db/schema';

/**
 * Phase 1 dev-owner seam.
 *
 * Monitors FK to `users.id`, but the auth boundary (better-auth) is Phase 6.
 * Until then, every monitor is owned by a single deterministic dev user so the
 * data model stays internally consistent (the FK is satisfied) without
 * hardcoding single-tenant assumptions into the schema (AGENT_NOTES
 * "Multi-tenant schema vs single-owner UI" — the `user_id` FK stays; only the
 * *resolution* of "who is the owner" is stubbed).
 *
 * Phase 6 (Task 6.1) replaces `resolveOwnerUserId(db)` with the session
 * user's id from the better-auth guard. The call sites in MonitorsService take
 * the owner id as a parameter, so swapping the source is a one-line change in
 * the controller, not a service rewrite.
 */
export const DEV_OWNER_EMAIL = 'owner@pulse.local';
const DEV_OWNER_NAME = 'Pulse Dev Owner';

let cachedOwnerId: string | null = null;

/** Ensure the dev owner exists and return its id (memoised per process). */
export async function resolveOwnerUserId(db: PulseDb): Promise<string> {
  if (cachedOwnerId) return cachedOwnerId;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEV_OWNER_EMAIL))
    .limit(1);

  const found = existing[0];
  if (found) {
    cachedOwnerId = found.id;
    return found.id;
  }

  const [created] = await db
    .insert(users)
    .values({ email: DEV_OWNER_EMAIL, name: DEV_OWNER_NAME })
    .returning({ id: users.id });

  if (!created) {
    throw new Error('failed to create the dev owner user');
  }
  cachedOwnerId = created.id;
  return created.id;
}
