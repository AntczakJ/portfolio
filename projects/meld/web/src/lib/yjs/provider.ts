'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { z } from 'zod';
import type * as Y from 'yjs';

import { env } from '@/lib/env';
import { useWelcomeStore } from '@/lib/stores/welcome-store';

import type { Awareness } from 'y-protocols/awareness';
import type { WSWelcomeFramePayload } from 'meld-server';

import type { AwarenessIdentity } from './awareness-schemas';

/**
 * `HocuspocusProvider` factory for the meld board route.
 *
 * Per ADR-002 + ADR-008 + AGENT_NOTES Task 1.3 — the canonical Yjs
 * + awareness wire client is `@hocuspocus/provider`, NOT the raw
 * `WebsocketProvider` from `y-websocket`. Hocuspocus speaks a
 * superset of the y-websocket protocol (the framework's `Auth`
 * handshake precedes the y-protocol sync handshake); a raw
 * `WebsocketProvider` does NOT complete the handshake against a
 * Hocuspocus-served `/ws/board/:boardId`.
 *
 * Wire path:
 *
 *   1. Browser opens `${env.wsUrl}/ws/board/<boardId>`. The
 *      `meld_session` cookie attaches automatically because the WS
 *      handshake is HTTP-on-the-wire and the browser sends cookies
 *      for the host. No explicit `Cookie` header forwarding is
 *      required.
 *   2. Hocuspocus's `connected` extension sends the welcome control
 *      message over the framework's **Stateless** channel (ADR-011 /
 *      Task 1.X-stateless), via `Connection.sendStateless(string)`.
 *      A stateless message is a valid y-protocol envelope
 *      (`MessageType.Stateless = 5`), so the provider decodes it
 *      natively and routes the inner string to our `onStateless`
 *      config callback as `{ payload: string }` — no raw
 *      `MessageEvent`, no TEXT/BINARY discrimination, no binary-decode
 *      error. (Provider d.ts: `onStateless` config callback line 352,
 *      `onStatelessParameters = { payload: string }` lines 162–164.)
 *   3. The `onStateless` handler `JSON.parse`s the payload (guarded),
 *      `safeParse`s it against `welcomeFrameSchema`, and on
 *      `kind === 'welcome'` calls `useWelcomeStore.setWelcome(welcome)`
 *      so `<IdentityBadge />` and the cursor-engine awareness seeder
 *      (Phase 3.3) hydrate. Unknown / reserved kinds route to
 *      `config.onUnknownControlFrame` (dev-warn, prod no-op). The
 *      handler never throws.
 *
 * The y-websocket sync + awareness protocol (the binary frames) is
 * handled entirely by the framework — we no longer intercept the raw
 * `'message'` event at all (ADR-011 removed the `onMessage` path).
 *
 * Singleton-per-boardId model:
 *
 *   `<BoardCanvasHost />` mounts once per route navigation. The host
 *   creates a provider via `createBoardProvider(boardId)`, holds the
 *   reference in `useRef`, and destroys on unmount. There is no
 *   process-wide registry — opening a second tab opens a second
 *   provider (and two distinct awareness identities per ADR-005's
 *   "two tabs = two cursors" rule). If a future feature wants to
 *   share a provider across two route segments inside the same tab
 *   (e.g., a board-detail panel sharing the same Y.Doc), introduce a
 *   registry then; v1 does not need it.
 *
 * Lifecycle teardown is by `provider.destroy()` — this disconnects
 * the WebSocket, unbinds the document observers, and cleans up the
 * awareness instance. The owning `<BoardCanvasHost />` calls
 * `engine.stop()` BEFORE `provider.destroy()` so the engine's
 * shape-map observer is detached before the document is torn down
 * (the inverse order would emit a benign "unobserving an already-
 * destroyed map" warning).
 */

/* ============================================================== *\
   Minimal client-side Zod schema for the welcome control message.

   The runtime cost is ~1 kB minified. We DO NOT import the server's
   Zod schemas (the runtime would ship the entire server schema tree
   to the browser). Instead, we hydrate a minimal parser sufficient
   for the welcome branch the v1 client acts on.

   ADR-011 moved control messages off raw TEXT frames onto Hocuspocus's
   Stateless channel; the payload shape is unchanged, so this schema is
   carried over verbatim from the retired TEXT path and validates the
   string delivered to `onStateless`.
\* ============================================================== */

const oklchColorSchema = z.object({
  L: z.number(),
  C: z.number(),
  H: z.number(),
});

const sessionIdentitySchema = z.object({
  id: z.uuid(),
  emojiChar: z.string().min(1),
  emojiName: z.string().min(1),
  color: oklchColorSchema,
  colorDark: oklchColorSchema,
  mintedAt: z.enum(['cookie', 'ws-onConnect']),
});

const boardMetadataSchema = z.object({
  id: z.uuid(),
  createdAt: z.number().int(),
  connectionCount: z.number().int().nonnegative(),
});

const welcomeFrameSchema = z.object({
  kind: z.literal('welcome'),
  session: sessionIdentitySchema,
  board: boardMetadataSchema,
  origin: z.string(),
  serverTime: z.number().int(),
  protocolVersion: z.literal(1),
});

/**
 * Compose `${env.wsUrl}/ws/board/<boardId>`. `env.wsUrl` is
 * `ws://localhost:3001` in dev and `wss://meld-demo.fly.dev` in
 * production (baked at build time per ADR-006). The board id is
 * URL-encoded defensively — UUIDs do not contain reserved chars but
 * a future short-id (base32) would.
 */
function composeBoardUrl(boardId: string): string {
  return `${env.wsUrl}/ws/board/${encodeURIComponent(boardId)}`;
}

export interface BoardProviderConfig {
  /** Pre-built `Y.Doc` instance the engine reads from. */
  doc: Y.Doc;
  /**
   * Optional callback for unknown control-message kinds (the
   * discriminator literals reserved in ADR-004 for v1.1 / v2, now
   * carried over the Stateless channel per ADR-011). Default: dev-only
   * `console.warn`, no-op in production.
   */
  onUnknownControlFrame?: (raw: unknown) => void;
}

/**
 * Create a `HocuspocusProvider` bound to the given board.
 *
 * The factory does NOT auto-destroy on hot-reload — callers own the
 * lifecycle. The owning `<BoardCanvasHost />` calls `.destroy()` on
 * unmount.
 *
 * The provider owns its own `Awareness` instance internally (we let
 * Hocuspocus construct it — passing an explicit one is supported but
 * unnecessary for v1). Consumers access it via `provider.awareness`
 * (typed `Awareness | null` because the framework allows opt-out;
 * v1 never opts out, so the cursor engine asserts non-null at
 * subscribe time).
 */
export function createBoardProvider(
  boardId: string,
  config: BoardProviderConfig,
): HocuspocusProvider {
  const url = composeBoardUrl(boardId);

  const provider = new HocuspocusProvider({
    url,
    name: boardId,
    document: config.doc,
    // No token — anonymous-link sharing is the v1 auth surface (the
    // session cookie identifies the user; the board id IS the
    // capability). Hocuspocus skips the `Auth` handshake when token
    // is absent.
    token: null,
    // ADR-011: control messages arrive over Hocuspocus's Stateless
    // channel, NOT raw TEXT frames. The provider decodes the stateless
    // y-protocol envelope natively and hands us the inner string as
    // `{ payload }` (d.ts `onStateless` line 352, `onStatelessParameters
    // = { payload: string }` lines 162–164). No `MessageEvent`, no
    // TEXT/BINARY discrimination, and — crucially — no `onMessage`
    // interception on the provider's `'message'` emitter, which is the
    // class of fragility ADR-011 removes (it caused the `9b06f7e`
    // sync-killer). This handler must never throw.
    onStateless: ({ payload }) => {
      handleStatelessControlMessage(payload, config.onUnknownControlFrame);
    },
  });

  // Awareness seed pipeline (Task 2.5a). The welcome message arriving
  // over the wire (now via `onStateless` per ADR-011) populates the
  // welcome store; we mirror its session identity onto the local
  // awareness state so REMOTE peers can read OUR identity (and vice
  // versa) through `useAwareness()`. This pipeline is transport-
  // agnostic — it consumes the welcome STORE, not the wire — so it is
  // unchanged by the ADR-011 transport move.
  attachAwarenessSeedPipeline(provider);

  return provider;
}

/* ============================================================== *\
   Awareness seed pipeline (Task 2.5a)

   When the welcome message lands (over the Stateless channel per
   ADR-011), mirror `welcome.session` into the local Yjs awareness
   state field `'identity'`. Two cases:

     A. Welcome lands AFTER provider construction (the common path —
        the provider IS the wire, welcome is the first stateless
        message after the framework's `Auth` handshake). The store
        subscription below fires the seed.

     B. Welcome lands BEFORE provider construction. Can happen if a
        session-rotate (POST /api/session) lit up the welcome store
        from a prior board mount and the user navigates between
        boards without a hard reload. The seed runs immediately at
        construction time, reading `useWelcomeStore.getState()`.

   Idempotency: `setLocalStateField` is a no-op when the field value
   is structurally unchanged (Yjs's awareness encoder hashes the
   value and skips the broadcast on equality). Calling the seed twice
   with the same payload costs one Map.get + one structural equality
   check.

   Lifecycle: the store unsubscribe runs on `provider.destroy()` via
   the framework's `destroy` event hook. The `useWelcomeStore.subscribe`
   return value is the unsubscribe function; we capture it and detach
   on provider destroy.
\* ============================================================== */

function welcomeToAwarenessIdentity(
  welcome: WSWelcomeFramePayload,
): AwarenessIdentity {
  return {
    sessionId: welcome.session.id,
    emojiChar: welcome.session.emojiChar,
    emojiName: welcome.session.emojiName,
    color: welcome.session.color,
    colorDark: welcome.session.colorDark,
  };
}

function seedAwarenessFromWelcome(
  provider: HocuspocusProvider,
  welcome: WSWelcomeFramePayload,
): void {
  const awareness = provider.awareness;
  if (awareness === null) return;
  awareness.setLocalStateField(
    'identity',
    welcomeToAwarenessIdentity(welcome),
  );
}

/**
 * Wire the welcome store → awareness seed. Exported for tests.
 *
 * @internal
 */
export function attachAwarenessSeedPipeline(
  provider: HocuspocusProvider,
): () => void {
  // Case B: welcome already in the store at construction time. Seed
  // immediately so the first awareness broadcast carries our identity
  // (the framework fans the local state out to peers as soon as the
  // Auth handshake completes; we want the identity field present at
  // that moment).
  const initial = useWelcomeStore.getState().welcome;
  if (initial !== null) {
    seedAwarenessFromWelcome(provider, initial);
  }

  // Case A: subscribe to welcome-store changes. When the next welcome
  // lands (the first one over the wire, or a session-rotate later),
  // re-seed.
  const unsubscribe = useWelcomeStore.subscribe((state, prevState) => {
    const next = state.welcome;
    if (next === null) return;
    // Re-seed only on actual welcome transitions. Strict reference
    // equality is sufficient — the store mutator replaces the whole
    // object via `set({ welcome })` so a no-op call would not show up
    // as a state change.
    if (next === prevState.welcome) return;
    seedAwarenessFromWelcome(provider, next);
  });

  // Detach the store listener when the provider tears down. The
  // framework emits `destroy` once on `provider.destroy()`.
  const onDestroy = (): void => {
    unsubscribe();
    provider.off('destroy', onDestroy);
  };
  provider.on('destroy', onDestroy);

  return unsubscribe;
}

/**
 * Parse + dispatch a control message delivered over Hocuspocus's
 * Stateless channel (ADR-011). The `payload` is the raw string the
 * server passed to `Connection.sendStateless` — the SAME
 * JSON-stringified control-frame shape ADR-004 defined, now carried
 * inside the y-protocol stateless envelope instead of a bare TEXT
 * frame. The payload byte-shape and the Zod schema are unchanged;
 * only the transport moved.
 *
 * On `kind === 'welcome'` we `safeParse` against `welcomeFrameSchema`
 * and call `useWelcomeStore.setWelcome(payload)`. Unknown / reserved
 * kinds route to `onUnknown` (dev-warn, prod no-op when unset).
 *
 * This MUST never throw — the JSON parse is guarded and every branch
 * returns cleanly.
 *
 * Exported for the test suite to drive without instantiating a real
 * provider.
 *
 * @internal
 */
export function handleStatelessControlMessage(
  payload: string,
  onUnknown?: (raw: unknown) => void,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // Malformed payload — log at warn in dev, silently drop in prod.
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[meld-provider] dropped malformed stateless payload (not JSON)',
      );
    }
    return;
  }

  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[meld-provider] dropped stateless payload without a `kind` discriminator',
        parsed,
      );
    }
    return;
  }

  const kind = parsed.kind;

  if (kind === 'welcome') {
    const result = welcomeFrameSchema.safeParse(parsed);
    if (!result.success) {
      // A welcome message that fails to parse is a contract regression
      // we want to surface loudly in dev. In production we log but
      // do not crash the board — the chrome stays whole and the
      // welcome store stays at its `null` floor.
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          '[meld-provider] welcome message failed to parse',
          result.error,
        );
      }
      return;
    }
    // The Zod inference and the types-only `WSWelcomeFramePayload`
    // re-exported from `meld-server` are structurally identical, but
    // TypeScript does not see them as the same nominal type. The cast
    // is the single seam — the parsed-and-validated welcome flows into
    // the store, which the awareness-seed pipeline observes.
    const welcome = result.data;
    useWelcomeStore.getState().setWelcome(welcome);
    return;
  }

  // Unknown / v1.1 / v2 kinds (heartbeat, settings.update, overrun,
  // board-deleted, kicked). v1 acts only on `welcome`; the rest route
  // to the caller's handler or a dev-only warn.
  if (onUnknown) {
    onUnknown(parsed);
    return;
  }
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `[meld-provider] unhandled control kind="${String(kind)}" ` +
        '(v1 only acts on `welcome`)',
    );
  }
}

/**
 * Helper: extract a non-null `Awareness` from a provider, throwing
 * loudly if the framework returned `null` (v1 never does, but the
 * type is `Awareness | null` so we narrow at the seam).
 */
export function requireAwareness(provider: HocuspocusProvider): Awareness {
  const awareness = provider.awareness;
  if (awareness === null) {
    throw new Error(
      'HocuspocusProvider.awareness was null. meld v1 always opts in ' +
        'to awareness — check createBoardProvider for an awareness: null ' +
        'override that should not exist.',
    );
  }
  return awareness;
}
