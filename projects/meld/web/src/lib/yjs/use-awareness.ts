'use client';

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import type { Awareness } from 'y-protocols/awareness';

import {
  parseAwarenessCursor,
  parseAwarenessIdentity,
  type AwarenessCursor,
  type AwarenessIdentity,
  type AwarenessPeer,
} from './awareness-schemas';

/**
 * `useAwareness` — React adapter over the Yjs `Awareness` instance
 * (Task 2.5a). Returns the local identity AND the list of remote
 * peers, recomputed on every awareness `'change'` event.
 *
 *   Subscription contract:
 *
 *     Implemented via `useSyncExternalStore` so React owns the
 *     subscribe / unsubscribe lifecycle and concurrent-rendering
 *     consumers see a tearing-free snapshot. The store's `subscribe`
 *     attaches a `'change'` listener on the `Awareness` instance and
 *     returns the detach function; React calls it on unmount.
 *
 *   Snapshot stability rule:
 *
 *     Yjs's `Awareness` fires `'change'` on EVERY local + remote state
 *     update, including the no-op refresh tick. `useSyncExternalStore`
 *     compares snapshots by reference, so returning a fresh array each
 *     call would force a re-render even when no peer actually changed.
 *     We memoise the snapshot by hashing the relevant fields
 *     (`clientId`s + each peer's `identity` shape) into a stable key
 *     and reuse the previous snapshot when the key matches. Result:
 *     the consuming component re-renders only when a peer's identity
 *     was meaningfully added / removed / updated.
 *
 *   Remote-peer filtering:
 *
 *     The local `clientID` (the connection's Yjs id) is EXCLUDED from
 *     the `remote` list. Two browser tabs sharing a `sessionId` see
 *     each other as remote (distinct `clientId`s per WS connection per
 *     ADR-005), which is the intended "two tabs = two cursors" UX.
 *
 *   Malformed-entry policy:
 *
 *     Each remote peer's `state.identity` is parsed against
 *     `awarenessIdentitySchema.safeParse`. Failures are dropped from
 *     the `remote` list silently in production and warned in dev.
 *     Failure mode = a peer connected on a different protocol version
 *     (v2 client on a v1 server) OR a deployed-demo regression that
 *     desynced the wire shape. The board chrome must stay whole;
 *     dropping a single bad peer is correct.
 *
 *   Dev observability:
 *
 *     Every 60 awareness changes, a `[meld-awareness]` log line emits
 *     `local={emojiName} remoteCount={N} peers=[...]`. Gated by
 *     `process.env.NODE_ENV === 'development'` + Terser DCE — the
 *     literal is stripped from the production bundle.
 */

/* ------------------------------------------------------------------ *\
   Snapshot construction
\* ------------------------------------------------------------------ */

interface AwarenessSnapshot {
  local: AwarenessIdentity | null;
  remote: ReadonlyArray<AwarenessPeer>;
  /** Stable signature for snapshot reuse across `getSnapshot()` calls. */
  signature: string;
}

const EMPTY_REMOTE: ReadonlyArray<AwarenessPeer> = Object.freeze([]);

function cursorSig(c: AwarenessCursor): string {
  // Cursor x/y are floats; rounding to one decimal keeps the signature
  // stable across the 30 ms throttle's micro-jitter while still flipping
  // on visible motion. The cursor engine paints sub-pixel motion via its
  // lerp loop independently — the signature only governs React re-renders
  // (which are O(consumers); the engine fan-out is unaffected).
  if (c === null) return 'n';
  return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
}

function buildSignature(
  local: AwarenessIdentity | null,
  remote: ReadonlyArray<AwarenessPeer>,
): string {
  // The signature collapses identity fields into a short hash-key. We
  // include every field the consumer can render (sessionId, emojiName,
  // emojiChar, color/colorDark via H component as the visual delta, plus
  // cursor position rounded to 1 decimal) so a real change always
  // invalidates. Stringify is fine here — the array is at most
  // `MAX_AWARENESS_PEERS` long (Phase 3.3 caps the rendered set; v1
  // demos never exceed ~10 concurrent peers per PLAN.md success criteria).
  const local_ =
    local === null
      ? 'none'
      : `${local.sessionId}|${local.emojiName}|${local.color.H}|${local.colorDark.H}`;
  if (remote.length === 0) {
    return `L=${local_};R=`;
  }
  const remoteSig = remote
    .map(
      (p) =>
        `${p.clientId}:${p.identity.sessionId}|${p.identity.emojiName}|${p.identity.color.H}|${p.identity.colorDark.H}|${cursorSig(p.cursor)}`,
    )
    .join(',');
  return `L=${local_};R=${remoteSig}`;
}

function readAwarenessSnapshot(
  awareness: Awareness,
): AwarenessSnapshot {
  const states = awareness.getStates();
  const ownClientId = awareness.clientID;
  const nowMs = Date.now();

  // Local first — extract from `states.get(ownClientId)` so we use the
  // same parse path as remote peers. Falls back to `null` if the local
  // state has not been seeded yet (welcome frame has not landed).
  let local: AwarenessIdentity | null = null;
  const localRaw = states.get(ownClientId);
  if (
    localRaw !== undefined &&
    typeof localRaw === 'object' &&
    localRaw !== null &&
    'identity' in localRaw
  ) {
    const parsed = parseAwarenessIdentity(
      (localRaw as { identity: unknown }).identity,
    );
    if (parsed.ok) {
      local = parsed.value;
    }
  }

  const remote: AwarenessPeer[] = [];
  states.forEach((state, clientId) => {
    if (clientId === ownClientId) return;
    if (state === null || typeof state !== 'object') return;
    if (!('identity' in state)) return;
    const parsed = parseAwarenessIdentity(
      (state as { identity: unknown }).identity,
    );
    if (!parsed.ok) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[meld-awareness] dropped malformed peer clientId=${String(clientId)}`,
          parsed.error.issues,
        );
      }
      return;
    }
    // Cursor is tolerant: malformed / missing collapses to `null` (off
    // canvas). A peer with a valid identity but no cursor is still a
    // valid peer — they just aren't pointing at the board right now.
    const cursorRaw =
      'cursor' in state ? (state as { cursor: unknown }).cursor : null;
    const cursor = parseAwarenessCursor(cursorRaw);
    remote.push({
      clientId,
      identity: parsed.value,
      cursor,
      lastSeenMs: nowMs,
    });
  });

  // Stable ordering by clientId so consumers (avatar stack, cursors)
  // see a deterministic peer list across renders even if Yjs's
  // internal Map iteration order shifts.
  remote.sort((a, b) => a.clientId - b.clientId);

  const frozenRemote = remote.length === 0 ? EMPTY_REMOTE : Object.freeze(remote);
  return {
    local,
    remote: frozenRemote,
    signature: buildSignature(local, frozenRemote),
  };
}

/* ------------------------------------------------------------------ *\
   Public hook
\* ------------------------------------------------------------------ */

export interface UseAwarenessResult {
  local: AwarenessIdentity | null;
  remote: ReadonlyArray<AwarenessPeer>;
}

/**
 * Subscribe to the given Yjs `Awareness` instance and read the local
 * + remote-peer snapshot. Pass `null` while the host is still
 * constructing the provider — the hook returns the empty snapshot.
 */
export function useAwareness(awareness: Awareness | null): UseAwarenessResult {
  // The snapshot ref carries the LAST returned object so we can reuse
  // it when the signature matches. `useSyncExternalStore` compares
  // `getSnapshot()` returns by reference; without this stability the
  // hook would force a re-render on every awareness tick even when
  // nothing visibly changed.
  const lastRef = useRef<AwarenessSnapshot | null>(null);
  // Dev-only change counter for the [meld-awareness] log cadence.
  const changeCountRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (awareness === null) {
        return () => undefined;
      }
      const handler = (): void => {
        // Invalidate the cached snapshot so the next `getSnapshot()`
        // re-reads and re-hashes.
        lastRef.current = null;
        changeCountRef.current += 1;
        // Dev observability: every 60 awareness changes, log a one-
        // liner. The whole branch is stripped by Terser DCE in
        // production (the literal compares as a constant).
        if (process.env.NODE_ENV === 'development') {
          if (changeCountRef.current % 60 === 0) {
            const snap = readAwarenessSnapshot(awareness);
            const localName = snap.local?.emojiName ?? 'none';
            const peerNames = snap.remote
              .map((p) => p.identity.emojiName)
              .join(',');
            console.log(
              `[meld-awareness] tick=${changeCountRef.current} ` +
                `local=${localName} remoteCount=${snap.remote.length} ` +
                `peers=[${peerNames}]`,
            );
          }
        }
        onStoreChange();
      };
      awareness.on('change', handler);
      return () => {
        awareness.off('change', handler);
      };
    },
    [awareness],
  );

  const getSnapshot = useCallback((): AwarenessSnapshot => {
    if (awareness === null) {
      // Stable empty snapshot — never reallocate when awareness is
      // null so React sees a single reference across renders.
      return EMPTY_SNAPSHOT;
    }
    const fresh = readAwarenessSnapshot(awareness);
    const prev = lastRef.current;
    if (prev !== null && prev.signature === fresh.signature) {
      return prev;
    }
    lastRef.current = fresh;
    return fresh;
  }, [awareness]);

  // SSR snapshot — `<BoardCanvasHost />` is `'use client'`, so we
  // never reach this on the server in practice, but `useSyncExternal
  // Store` requires a serializable initial value. Return the empty
  // snapshot.
  const getServerSnapshot = useCallback((): AwarenessSnapshot => {
    return EMPTY_SNAPSHOT;
  }, []);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  // Surface only the public fields to consumers. The signature is an
  // internal stability hash; do not leak it.
  return useMemo(
    () => ({ local: snapshot.local, remote: snapshot.remote }),
    [snapshot],
  );
}

const EMPTY_SNAPSHOT: AwarenessSnapshot = Object.freeze({
  local: null,
  remote: EMPTY_REMOTE,
  signature: 'L=none;R=',
});
