import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { useAwareness } from '../use-awareness';
import type { AwarenessIdentity } from '../awareness-schemas';

/**
 * `useAwareness` — local / remote split + malformed-entry drop +
 * subscribe-once via `useSyncExternalStore` (Task 2.5a).
 *
 * Strategy: construct a REAL `Awareness` instance against a real
 * `Y.Doc` — y-protocols is JS, runs cleanly under jsdom — and drive
 * remote peers by directly writing into `awareness.states` then
 * emitting a synthetic `'change'` event (the same pathway Yjs's own
 * decoder uses on inbound updates). This keeps the test surface
 * close to the production wire shape without requiring two providers
 * and a real WebSocket.
 */

function buildIdentity(
  sessionId: string,
  emojiName: string,
  H: number,
): AwarenessIdentity {
  return {
    sessionId,
    emojiChar: '\u{1F367}',
    emojiName,
    color: { L: 0.6, C: 0.17, H },
    colorDark: { L: 0.7, C: 0.18, H },
  };
}

/**
 * Force Yjs awareness to expose a state at the given clientId without
 * going through the wire-format encode/decode dance. The production
 * codepath populates `awareness.states` via `applyAwarenessUpdate`;
 * we shortcut by writing the Map entry directly and emitting the
 * `'change'` event the way the decoder would.
 */
function injectRemotePeer(
  awareness: Awareness,
  clientId: number,
  state: Record<string, unknown> | null,
): void {
  if (state === null) {
    awareness.states.delete(clientId);
    awareness.meta.delete(clientId);
    awareness.emit('change', [
      { added: [], updated: [], removed: [clientId] },
      'test',
    ]);
    return;
  }
  const exists = awareness.states.has(clientId);
  awareness.states.set(clientId, state);
  awareness.meta.set(clientId, {
    clock: (awareness.meta.get(clientId)?.clock ?? 0) + 1,
    lastUpdated: Date.now(),
  });
  awareness.emit('change', [
    {
      added: exists ? [] : [clientId],
      updated: exists ? [clientId] : [],
      removed: [],
    },
    'test',
  ]);
}

const SESSION_LOCAL = '8f41d59d-9ad8-4db5-94fc-c5a5ced3b43f';
const SESSION_REMOTE_A = '7a628a49-1234-4abc-8def-abcdef012345';
const SESSION_REMOTE_B = '6b517a38-9876-4cde-9f01-fedcba987654';

describe('useAwareness', () => {
  let doc: Y.Doc;
  let awareness: Awareness;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    doc = new Y.Doc();
    awareness = new Awareness(doc);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Run under dev so the malformed-peer warn path emits — the
    // production gate would silently drop and we couldn't assert on
    // the warn. `vi.stubEnv` restores on `vi.unstubAllEnvs()`.
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    warnSpy.mockRestore();
    awareness.destroy();
    doc.destroy();
    vi.unstubAllEnvs();
  });

  it('returns the empty snapshot when awareness is null', () => {
    const { result } = renderHook(() => useAwareness(null));
    expect(result.current.local).toBeNull();
    expect(result.current.remote).toEqual([]);
  });

  it('exposes the local identity once setLocalStateField fires', () => {
    const { result } = renderHook(() => useAwareness(awareness));
    expect(result.current.local).toBeNull();

    act(() => {
      awareness.setLocalStateField(
        'identity',
        buildIdentity(SESSION_LOCAL, 'otter', 285),
      );
    });

    expect(result.current.local).not.toBeNull();
    expect(result.current.local?.sessionId).toBe(SESSION_LOCAL);
    expect(result.current.local?.emojiName).toBe('otter');
    expect(result.current.remote).toEqual([]);
  });

  it('excludes the local clientId from the remote list', () => {
    const { result } = renderHook(() => useAwareness(awareness));

    act(() => {
      awareness.setLocalStateField(
        'identity',
        buildIdentity(SESSION_LOCAL, 'otter', 285),
      );
    });

    // Inject a separate remote clientId — must NOT collide with
    // awareness.clientID (the local one).
    const remoteClientId = awareness.clientID + 1;
    act(() => {
      injectRemotePeer(awareness, remoteClientId, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
      });
    });

    expect(result.current.local?.sessionId).toBe(SESSION_LOCAL);
    expect(result.current.remote).toHaveLength(1);
    expect(result.current.remote[0]?.clientId).toBe(remoteClientId);
    expect(result.current.remote[0]?.identity.emojiName).toBe('fox');
    // Missing cursor defaults to null per Phase 3.3 forward-compat
    // shim — peers that never moved their pointer should not crash
    // consumers, just render with no cursor.
    expect(result.current.remote[0]?.cursor).toBeNull();
    // The hook returns a defensively-frozen array — mutation should
    // not be possible (consumers must not push into it).
    expect(Object.isFrozen(result.current.remote)).toBe(true);
  });

  it('surfaces a peer cursor when the cursor field is present', () => {
    const { result } = renderHook(() => useAwareness(awareness));
    const remoteClientId = awareness.clientID + 1;

    act(() => {
      injectRemotePeer(awareness, remoteClientId, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
        cursor: { x: 123.4, y: 567.8 },
      });
    });

    expect(result.current.remote).toHaveLength(1);
    expect(result.current.remote[0]?.cursor).toEqual({
      x: 123.4,
      y: 567.8,
    });
  });

  it('surfaces null when the peer reports cursor: null', () => {
    const { result } = renderHook(() => useAwareness(awareness));
    const remoteClientId = awareness.clientID + 1;

    act(() => {
      injectRemotePeer(awareness, remoteClientId, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
        cursor: null,
      });
    });

    expect(result.current.remote).toHaveLength(1);
    expect(result.current.remote[0]?.cursor).toBeNull();
  });

  it('treats a malformed cursor as null without dropping the peer', () => {
    const { result } = renderHook(() => useAwareness(awareness));
    const remoteClientId = awareness.clientID + 1;

    act(() => {
      injectRemotePeer(awareness, remoteClientId, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
        // x is a string — schema fails, cursor collapses to null,
        // peer still appears in the remote list because identity is
        // intact.
        cursor: { x: 'not-a-number', y: 0 },
      });
    });

    expect(result.current.remote).toHaveLength(1);
    expect(result.current.remote[0]?.cursor).toBeNull();
  });

  it('invalidates the snapshot when cursor position changes', () => {
    const { result } = renderHook(() => useAwareness(awareness));
    const remoteClientId = awareness.clientID + 1;

    act(() => {
      injectRemotePeer(awareness, remoteClientId, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
        cursor: { x: 10, y: 20 },
      });
    });
    const first = result.current.remote;
    expect(first[0]?.cursor).toEqual({ x: 10, y: 20 });

    act(() => {
      injectRemotePeer(awareness, remoteClientId, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
        cursor: { x: 50, y: 80 },
      });
    });
    const second = result.current.remote;
    expect(second).not.toBe(first);
    expect(second[0]?.cursor).toEqual({ x: 50, y: 80 });
  });

  it('drops malformed remote peers and warns in dev', () => {
    const { result } = renderHook(() => useAwareness(awareness));
    const remoteClientId = awareness.clientID + 7;

    act(() => {
      injectRemotePeer(awareness, remoteClientId, {
        identity: {
          // sessionId missing — schema rejects.
          emojiChar: 'X',
          emojiName: 'bad-peer',
          color: { L: 0.6, C: 0.17, H: 60 },
          colorDark: { L: 0.7, C: 0.18, H: 60 },
        },
      });
    });

    expect(result.current.remote).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const [firstCall] = warnSpy.mock.calls;
    expect(firstCall?.[0]).toContain('[meld-awareness]');
    expect(firstCall?.[0]).toContain('dropped malformed peer');
  });

  it('updates remote list on awareness change', () => {
    const { result } = renderHook(() => useAwareness(awareness));
    const remoteA = awareness.clientID + 11;
    const remoteB = awareness.clientID + 13;

    act(() => {
      injectRemotePeer(awareness, remoteA, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
      });
    });
    expect(result.current.remote).toHaveLength(1);

    act(() => {
      injectRemotePeer(awareness, remoteB, {
        identity: buildIdentity(SESSION_REMOTE_B, 'panda', 150),
      });
    });
    expect(result.current.remote).toHaveLength(2);
    // Stable ordering by clientId.
    expect(result.current.remote[0]?.clientId).toBe(remoteA);
    expect(result.current.remote[1]?.clientId).toBe(remoteB);

    act(() => {
      injectRemotePeer(awareness, remoteA, null);
    });
    expect(result.current.remote).toHaveLength(1);
    expect(result.current.remote[0]?.clientId).toBe(remoteB);
  });

  it('reuses the snapshot reference when nothing meaningful changed', () => {
    const { result, rerender } = renderHook(() => useAwareness(awareness));
    const remoteA = awareness.clientID + 21;

    act(() => {
      injectRemotePeer(awareness, remoteA, {
        identity: buildIdentity(SESSION_REMOTE_A, 'fox', 60),
      });
    });
    const firstRemote = result.current.remote;
    expect(firstRemote).toHaveLength(1);

    // Force a no-op rerender — the snapshot ref should be stable.
    rerender();
    expect(result.current.remote).toBe(firstRemote);
  });

  it('unsubscribes the change listener on unmount', () => {
    const offSpy = vi.spyOn(awareness, 'off');
    const { unmount } = renderHook(() => useAwareness(awareness));
    unmount();
    expect(offSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
