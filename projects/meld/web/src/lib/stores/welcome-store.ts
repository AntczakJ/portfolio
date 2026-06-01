'use client';

import { create } from 'zustand';

import type { WSWelcomeFramePayload } from 'meld-server';

/**
 * Welcome-store — session-scoped Zustand store holding the WS welcome
 * frame payload (ADR-004 / ADR-005, Task 2.5b).
 *
 * The store owns ONE field: the most recent welcome payload received
 * from the server, or `null` until the WebSocket handshake completes.
 *
 * Wire path:
 *
 *   1. Page renders. Server component reads the `meld_session` cookie
 *      via `GET /api/session` and seeds `<IdentityBadge initial={...} />`
 *      with the resolved identity (id + emoji char + emoji name). NO
 *      color information yet — the awareness color is per-board and
 *      only the welcome frame carries it (ADR-005 derivation).
 *   2. Client mounts. The Yjs `WebsocketProvider` (Task 2.5a) opens
 *      the `/ws/board/:boardId` socket. The server emits the welcome
 *      TEXT frame inside the Hocuspocus `connected` hook (Task 1.X-
 *      control). The client parses the JSON against a minimal Zod
 *      schema set hydrated from `wsControlFrameSchema`-shape types and
 *      calls `setWelcome(payload)` on this store.
 *   3. `<IdentityBadgeClient />` re-renders with the resolved color
 *      ring (light + dark variants) and animates the ring from the
 *      neutral default to the user's color over 320 ms.
 *
 * NO persistence: welcome is session-scoped to a single live
 * WebSocket connection. The cookie carries identity across reloads;
 * the welcome frame is the authority on the running connection's
 * color, which is per-board and must be re-derived on every fresh
 * board open. Persisting it would leak stale board-scoped color into
 * the next board's first paint.
 *
 * `WSWelcomeFramePayload` is a TYPES-ONLY import from `meld-server`
 * — the Zod schema's runtime never reaches the browser bundle. The
 * web side hydrates its own parser when Task 2.5a wires the message
 * handler.
 *
 * Task 2.5a will call `setWelcome(...)` from the WS message handler
 * once the welcome TEXT frame is parsed. Until then, the store is a
 * read-only `null` floor for `<IdentityBadgeClient />` and the
 * `useIdentity()` hook below.
 */

interface WelcomeStoreState {
  welcome: WSWelcomeFramePayload | null;
  setWelcome: (payload: WSWelcomeFramePayload) => void;
  clearWelcome: () => void;
}

export const useWelcomeStore = create<WelcomeStoreState>()((set) => ({
  welcome: null,
  setWelcome: (payload) => {
    set({ welcome: payload });
  },
  clearWelcome: () => {
    set({ welcome: null });
  },
}));
