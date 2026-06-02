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
 *   2. Hocuspocus's `connected` extension fires the welcome TEXT
 *      frame (Task 1.X-control / Task 1.7b). The provider's
 *      `onMessage` config callback receives a `MessageEvent` per
 *      raw WS frame; we discriminate `typeof event.data === 'string'`
 *      vs `instanceof ArrayBuffer` per ADR-004.
 *   3. TEXT frames are parsed against `wsControlFrameSchema` (hydrated
 *      from a minimal Zod schema set — NO test fixtures, NO server
 *      runtime). On `kind === 'welcome'` we call
 *      `useWelcomeStore.setWelcome(payload)` so `<IdentityBadge />`
 *      and the cursor-engine awareness seeder (Phase 3.3) hydrate.
 *   4. BINARY frames are the y-websocket protocol — Hocuspocus's own
 *      handler processes them via `provider.document` / `provider.
 *      awareness` natively. We do NOT intercept binary; the
 *      `onMessage` callback fires alongside the framework's own
 *      handling, not instead of it.
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
   Minimal client-side Zod schemas for TEXT-frame control discrimination.

   The runtime cost is ~1 kB minified. We DO NOT import the server's
   Zod schemas (the runtime would ship the entire server schema tree
   to the browser). Instead, we hydrate a minimal parser sufficient
   for the welcome + overrun + board-deleted branches the v1 client
   acts on.

   Task 2.5a will own the full control-frame discriminated-union
   parser. Phase 2.6's scope is: parse `welcome`, dispatch to
   `useWelcomeStore.setWelcome(payload)`, log unknown frames at warn.
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
   * Optional callback for unknown TEXT-frame kinds (the discriminator
   * literals reserved in ADR-004 for v1.1 / v2). Default: dev-only
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
    onMessage: (payload) => {
      // HocuspocusProvider 4.1 emits the RAW browser `MessageEvent` to
      // its `'message'` listeners (see `attachWebSocketListeners` ->
      // `emit('message', event)`), despite the published
      // `onMessageParameters` type declaring `{ event, message }`. The
      // typed shape does NOT match the runtime emit for this callback
      // path. A throw here is catastrophic, not cosmetic: our listener
      // is registered BEFORE the provider's own y-protocol sync
      // listener, the emitter dispatches via `forEach`, and a
      // synchronous throw aborts that loop — so the framework's sync +
      // awareness handler never runs and the whole CRDT wire goes dead.
      // Accept BOTH shapes defensively and never throw.
      const raw = payload as unknown as
        | MessageEvent
        | { event?: MessageEvent };
      const event = raw instanceof MessageEvent ? raw : raw.event;
      if (!event) return;
      handleProviderMessage(event, config.onUnknownControlFrame);
    },
  });

  // Awareness seed pipeline (Task 2.5a). The welcome frame arriving
  // over the wire populates the welcome store; we mirror its session
  // identity onto the local awareness state so REMOTE peers can read
  // OUR identity (and vice versa) through `useAwareness()`.
  attachAwarenessSeedPipeline(provider);

  return provider;
}

/* ============================================================== *\
   Awareness seed pipeline (Task 2.5a)

   When the welcome TEXT frame lands, mirror `welcome.session` into
   the local Yjs awareness state field `'identity'`. Two cases:

     A. Welcome lands AFTER provider construction (the common path —
        the provider IS the wire, welcome is the first TEXT frame
        after the framework's `Auth` handshake). The store subscription
        below fires the seed.

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
 * Discriminate TEXT vs BINARY on a raw WS `MessageEvent`. TEXT is
 * meld's control frame (welcome, overrun, board-deleted) per ADR-004;
 * BINARY is the y-websocket protocol Hocuspocus handles natively (we
 * do NOTHING with binary frames here — the framework's own listener
 * is invoked alongside this callback).
 *
 * Exported for the test suite to drive without instantiating a real
 * provider.
 *
 * @internal
 */
export function handleProviderMessage(
  event: MessageEvent | null | undefined,
  onUnknown?: (raw: unknown) => void,
): void {
  // Defensive: a nullish event must never throw. The caller in
  // `createBoardProvider` already guards against this, but a throw
  // here would abort the provider's emitter `forEach` and kill the
  // framework's own sync listener — so we belt-and-braces it.
  if (!event) return;

  // BINARY — the y-websocket protocol. Pass through; the framework
  // owns it.
  if (typeof event.data !== 'string') return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.data);
  } catch {
    // Malformed TEXT — log at warn in dev, silently drop in prod.
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[meld-provider] dropped malformed TEXT frame (not JSON)',
      );
    }
    return;
  }

  if (typeof parsed !== 'object' || parsed === null || !('kind' in parsed)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[meld-provider] dropped TEXT frame without a `kind` discriminator',
        parsed,
      );
    }
    return;
  }

  const kind = (parsed).kind;

  if (kind === 'welcome') {
    const result = welcomeFrameSchema.safeParse(parsed);
    if (!result.success) {
      // A welcome frame that fails to parse is a contract regression
      // we want to surface loudly in dev. In production we log but
      // do not crash the board — the chrome stays whole and the
      // welcome store stays at its `null` floor.
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          '[meld-provider] welcome frame failed to parse',
          result.error,
        );
      }
      return;
    }
    // The Zod inference and the types-only `WSWelcomeFramePayload`
    // re-exported from `meld-server` are structurally identical, but
    // TypeScript does not see them as the same nominal type. The
    // cast is the single seam — Phase 2.5a will share this parser
    // surface; for Phase 2.6 the boundary is the cast here.
    const payload = result.data;
    useWelcomeStore.getState().setWelcome(payload);
    return;
  }

  // Unknown / v1.1 / v2 kinds (heartbeat, settings.update, overrun,
  // board-deleted, kicked) — Task 2.5a wires them. Phase 2.6 logs at
  // warn in dev only.
  if (onUnknown) {
    onUnknown(parsed);
    return;
  }
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `[meld-provider] unhandled control kind="${String(kind)}" ` +
        '(Phase 2.6 only handles `welcome`; Task 2.5a wires the rest)',
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
