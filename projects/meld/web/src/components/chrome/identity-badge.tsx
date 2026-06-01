import type { ReactNode } from 'react';

import { IdentityBadgeClient } from '@/components/chrome/identity-badge-client';
import type { InitialIdentity } from '@/lib/identity/use-identity';

/**
 * Brand-corner identity badge (Task 2.5b — ADR-004 + ADR-005).
 *
 * Sits between `<BrandMark />` and `<ApiStatusDot />` in the top bar.
 * Visual shape:
 *
 *   [ ring(emoji) ] [ emoji-name ]
 *
 *   - 28 px capsule, subtle surface bg.
 *   - Emoji rendered inside a thin ring whose color is the user's
 *     awareness color slot 0 (board-scoped, ADR-005 derivation).
 *   - Name rendered in mono kebab-case ("fox", "ice-cream").
 *
 * Server render (this component) starts with the cookie-derived
 * identity passed via `initial`. The color ring uses the neutral
 * `--color-fg-muted` token as a default because the per-board
 * awareness color is only known once the WS welcome frame arrives
 * (the color depends on the connected boardId; see ADR-005
 * `fnv1a(sessionId + ':' + boardId) % 8`).
 *
 * Client hydration ({@link IdentityBadgeClient}) subscribes to the
 * `useWelcomeStore` Zustand store. When Task 2.5a fires
 * `setWelcome(payload)`, the client wrapper upgrades the ring to the
 * resolved OKLCH color (light + dark variant) with a 320 ms
 * easeOutCubic transition. Server -> client transition is a single
 * component state change, not a render fork, so no hydration mismatch.
 *
 * Anonymous fallback (`initial === null`): no emoji, a monospace
 * em-dash in place of the name, neutral color, no tooltip. Triggered
 * when the `/api/session` round-trip failed (server down) AND no
 * usable cookie was present. The chrome stays whole; the
 * `<ApiStatusDot />` carries the operator-facing signal for the
 * API state.
 *
 * Why a single client component instead of a server shell that hands
 * off to a client child: the server render needs to match the
 * client's initial render byte-for-byte to avoid a hydration warning,
 * and the welcome upgrade is a state transition on the same instance.
 * Wrapping the server output in a `'use client'` boundary is the
 * cheapest path — the client component reads `initial` as a prop on
 * its first render, which IS the same shape the server would have
 * rendered, then re-renders on welcome arrival.
 */

export interface IdentityBadgeProps {
  initial: InitialIdentity | null;
}

export function IdentityBadge({ initial }: IdentityBadgeProps): ReactNode {
  return <IdentityBadgeClient initial={initial} />;
}
