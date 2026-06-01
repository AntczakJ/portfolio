'use client';

import { useWelcomeStore } from '@/lib/stores/welcome-store';

import type { WSOklchColor } from 'meld-server';

/**
 * `useIdentity` — client hydration hook reconciling the cookie-derived
 * initial identity with the WS welcome frame (Task 2.5b).
 *
 * Initial render comes from the server `<IdentityBadge initial={...} />`
 * prop (sourced via `GET /api/session` against the `meld_session`
 * cookie). The server prop carries the deterministic id + emoji char +
 * emoji name; it does NOT carry the awareness color because that is
 * board-scoped and only the WS welcome frame derives it
 * (`fnv1a(sessionId + ':' + boardId) % 8` per ADR-005).
 *
 * Once the WS welcome frame arrives (Task 2.5a fires
 * `useWelcomeStore.setWelcome(payload)`), the hook upgrades to the
 * live welcome payload: same id (server is authority), color + dark
 * color resolved against the connected board, and a `mintedAt`
 * discriminator the client uses to decide whether to POST
 * `/api/session` to persist the cookie out-of-band (per ADR-005's
 * cookie-disabled fallback).
 *
 * The cookie ↔ welcome reconciliation rule (server is the authority on
 * the running connection's identity) lives at the consumer site —
 * `<IdentityBadgeClient />` reads the welcome payload directly when
 * present and falls back to the initial prop otherwise. This hook
 * exposes BOTH the initial prop AND the welcome payload through a
 * single resolved view so the consumer does not have to merge by hand.
 *
 * Returning `null` for `color` / `colorDark` / `mintedAt` until the
 * welcome arrives is the load-bearing signal that the badge should
 * keep rendering its neutral default ring rather than guess at a hue.
 *
 * The hook is a thin selector over `useWelcomeStore` plus the initial
 * prop the consumer passes in. The prop carries the SSR-known identity
 * so the first client render matches the server render exactly — no
 * hydration mismatch — and the welcome upgrade is a state transition
 * the same component instance handles, not a render fork.
 */

export interface InitialIdentity {
  id: string;
  emojiChar: string;
  emojiName: string;
}

export type IdentityMintedAt = 'cookie' | 'ws-onConnect' | 'fallback';

export interface ResolvedIdentity {
  id: string;
  emojiChar: string;
  emojiName: string;
  color: WSOklchColor | null;
  colorDark: WSOklchColor | null;
  mintedAt: IdentityMintedAt | null;
}

/**
 * Pure selector — extracted so consumers that need it for memoised
 * derived values can reuse the rule without re-subscribing to the
 * store. Treat `welcome === null` as "no welcome yet" — the consumer
 * keeps rendering the initial prop's identity with no color ring.
 */
export function resolveIdentity(
  initial: InitialIdentity | null,
  welcome: ReturnType<typeof useWelcomeStore.getState>['welcome'],
): ResolvedIdentity | null {
  if (welcome) {
    return {
      id: welcome.session.id,
      emojiChar: welcome.session.emojiChar,
      emojiName: welcome.session.emojiName,
      color: welcome.session.color,
      colorDark: welcome.session.colorDark,
      mintedAt: welcome.session.mintedAt,
    };
  }
  if (initial) {
    return {
      id: initial.id,
      emojiChar: initial.emojiChar,
      emojiName: initial.emojiName,
      color: null,
      colorDark: null,
      mintedAt: null,
    };
  }
  return null;
}

export function useIdentity(
  initial: InitialIdentity | null,
): ResolvedIdentity | null {
  const welcome = useWelcomeStore((state) => state.welcome);
  return resolveIdentity(initial, welcome);
}
