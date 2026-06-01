import { randomUUID } from 'node:crypto';

import type { Extension, onConnectPayload } from '@hocuspocus/server';

import { SESSION_COOKIE_NAME } from '../session/cookie';
import { isUuidV4, readCookieFromHeader } from '../session/cookie-parser';
import {
  AWARENESS_WHEEL,
  colorSlotFor,
  type OklchTriple,
} from '../session/color';
import { emojiFor } from '../session/emoji';
import { sessionMetrics } from '../session/metrics';
import type { MeldConnectionContext } from './server';

/**
 * Hocuspocus cookie-read `onConnect` extension (Task 1.7b — ADR-005).
 *
 * Replaces the Task 1.4 stub that returned `{ sessionId: 'pending', ... }`
 * with the real cookie-derived identity wire. The extension reads the
 * `meld_session` cookie out of the WS upgrade request's `Cookie:` header,
 * validates it as a UUID v4, and either reuses it or mints a fresh one.
 * The full session identity (id, emoji, board-scoped OKLCH colors,
 * minted-at discriminator) is returned from `onConnect` so Hocuspocus
 * merges it into `connection.context` for every subsequent hook.
 *
 * Per ADR-005, the canonical derivation rule is:
 *
 *   - `emojiName = EMOJI_WHITELIST[fnv1a32(sessionId) % 128]` — per-session,
 *     persists across boards (cross-board identity thread).
 *   - `color = AWARENESS_WHEEL[fnv1a32(sessionId + ':' + boardId) % 8]` —
 *     per-board, rotates across boards (per-board collision-avoider).
 *
 * Both derivations are computed here at `onConnect` time so downstream
 * hooks (especially the welcome-emit on `connected`) read a fully
 * resolved identity from `connection.context` without re-hashing.
 *
 * Extension order matters:
 *
 *   - This extension's `onConnect` MUST run BEFORE the welcome-emit
 *     extension's `connected` hook. Within Hocuspocus 4.1 the lifecycle
 *     guarantees `onConnect` completes for ALL extensions before
 *     `connected` fires for ANY extension — the framework awaits the
 *     full `onConnect` chain inside `setUpNewConnection` BEFORE invoking
 *     `connected` (verified against `node_modules/@hocuspocus/server/
 *     dist/hocuspocus-server.esm.js` line ~881 where the `connected`
 *     hook is fired only AFTER the `Connection` instance is constructed
 *     and the `onConnect` chain has resolved). So registering this
 *     extension at any priority is correct — Task 1.4's `priority: 0`
 *     (preserved here for grep-ability) is fine.
 *
 *   - The existing Origin-allowlist check in the older stub extension
 *     (`createMeldExtension` in `server.ts`) remains the authoritative
 *     allowlist gate. We do NOT duplicate the Origin check here — the
 *     pre-upgrade HTTP 403 path in `server.ts` `attach()` runs the same
 *     check before the WS handshake even completes, and the
 *     `createMeldExtension` defence-in-depth catches anything that
 *     slipped through. If the order between this extension and
 *     `createMeldExtension` matters for any future change, the
 *     allowlist extension MUST run first so a rejected Origin never
 *     reaches the cookie parser.
 *
 * Hocuspocus context merge semantics: when an extension's `onConnect`
 * returns an object, the framework `Object.assign`-merges it onto
 * `payload.context` (verified at esm line ~707). So returning
 * `{ session: {...} }` from this hook adds the `session` field without
 * stomping on `sessionId`/`cookiePresent` returned by the older
 * `createMeldExtension` — both fields coexist on the merged context.
 */

/**
 * The full session-identity payload stamped onto `connection.context.session`
 * by this extension. Consumed by `welcome.ts` at emit time and by any
 * future hook that needs the resolved identity (e.g., the v2 auth path).
 */
export interface MeldSessionIdentity {
  /** UUID v4 — from the cookie or fresh-minted. */
  id: string;
  /** Single-codepoint emoji string from the curated whitelist. */
  emojiChar: string;
  /** Lowercase kebab-case ASCII aria-label ('otter', 'panda'). */
  emojiName: string;
  /** OKLCH triple for the light theme variant — per-board. */
  color: OklchTriple;
  /** OKLCH triple for the dark theme variant — per-board. */
  colorDark: OklchTriple;
  /**
   * Whether the id was sourced from the cookie or minted here.
   * `'cookie'` — `meld_session` cookie carried a valid UUID v4.
   * `'ws-onConnect'` — cookie absent/malformed; minted via
   * `crypto.randomUUID()`. The welcome frame echoes this discriminator
   * so the client knows whether to POST `/api/session` to persist the
   * cookie out-of-band.
   */
  mintedAt: 'cookie' | 'ws-onConnect';
}

interface CreateOptions {
  /** Inject a UUID minter for deterministic tests. */
  uuidMinter?: () => string;
}

/**
 * Construct the cookie-read extension. Factory shape (rather than a bare
 * exported extension instance) mirrors `createSessionCookieMiddleware`'s
 * pattern — lets tests inject a deterministic UUID minter without
 * monkey-patching `node:crypto`.
 */
export function createSessionContextExtension(
  options: CreateOptions = {},
): Extension<MeldConnectionContext> {
  const mint = options.uuidMinter ?? randomUUID;

  return {
    extensionName: 'meld-session-context',
    /**
     * Priority 10 — runs AFTER `createMeldExtension` (priority 0) which
     * owns the Origin allowlist defence-in-depth, but BEFORE the welcome
     * extension (priority 50) which consumes the resolved
     * `connection.context.session`. The `connected` lifecycle ordering
     * within Hocuspocus does NOT depend on extension priority (the
     * framework awaits the full `onConnect` chain before firing
     * `connected` on any extension), so the priority here is purely for
     * grep-ability and not load-bearing.
     */
    priority: 10,

    // eslint-disable-next-line @typescript-eslint/require-await
    async onConnect(
      payload: onConnectPayload<MeldConnectionContext>,
    ): Promise<Partial<MeldConnectionContext>> {
      const cookieHeader = payload.requestHeaders.get('cookie');
      const cookieValue = readCookieFromHeader(cookieHeader, SESSION_COOKIE_NAME);

      let sessionId: string;
      let mintedAt: MeldSessionIdentity['mintedAt'];

      if (isUuidV4(cookieValue)) {
        sessionId = cookieValue;
        mintedAt = 'cookie';
        sessionMetrics.recordWsLoad();
      } else {
        sessionId = mint();
        mintedAt = 'ws-onConnect';
        sessionMetrics.recordWsMint();
      }

      const emoji = emojiFor(sessionId);
      const slot = colorSlotFor(sessionId, payload.documentName);
      const wheel = AWARENESS_WHEEL[slot];

      const session: MeldSessionIdentity = {
        id: sessionId,
        emojiChar: emoji.char,
        emojiName: emoji.name,
        color: wheel.light,
        colorDark: wheel.dark,
        mintedAt,
      };

      // Return the partial context the framework merges. Note: the Task
      // 1.4 `createMeldExtension` already returns `{ sessionId: 'pending',
      // cookiePresent }`. The framework `Object.assign`-merges every
      // `onConnect` return value, so the final `connection.context`
      // carries `{ sessionId, cookiePresent, session }` after this
      // extension runs. We OVERRIDE `sessionId` with the resolved value
      // so any consumer reading `context.sessionId` directly (instead of
      // `context.session.id`) sees the real id — this maintains the
      // backwards-compatible contract Task 1.4 set up while the
      // welcome.ts builder migrates to reading `context.session`.
      return {
        sessionId,
        session,
      };
    },
  };
}

/**
 * Default extension instance for production wiring in
 * `src/lib/ws/server.ts`. Tests construct their own via the factory.
 */
export const sessionContextExtension = createSessionContextExtension();
