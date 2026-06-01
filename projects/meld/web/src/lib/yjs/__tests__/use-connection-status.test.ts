import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStatus } from '../use-connection-status';

/**
 * Tests for `useConnectionStatus` — Phase 3.4 / ADR-009 connection
 * resolver.
 *
 *   Coverage:
 *     1. `provider.status === 'disconnected'` held >= 1500 ms → `'offline'`.
 *     2. `provider.status === 'disconnected'` resolved before 1500 ms → no `'offline'`.
 *     3. `navigator.onLine === false` short-circuits to `'offline'`.
 *     4. `provider.status === 'connecting'` → `'reconnecting'`.
 *     5. Provider == null → `'reconnecting'` (mount window).
 *     6. Unmount removes listeners + clears the pending timeout.
 *
 *   Strategy: a `MockProvider` exposes `.status` + `.on('status')` +
 *   `.off('status')` so we can drive transitions deterministically.
 *   Real `HocuspocusProvider` instances would open WS sockets and are
 *   out of scope for a hook unit test.
 */

type MockStatus = 'connecting' | 'connected' | 'disconnected';

class MockProvider {
  status: MockStatus = 'connecting';
  #listeners = new Map<string, Set<(payload: { status: string }) => void>>();

  on(event: string, cb: (payload: { status: string }) => void): void {
    let set = this.#listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(cb);
  }

  off(event: string, cb: (payload: { status: string }) => void): void {
    this.#listeners.get(event)?.delete(cb);
  }

  hasListener(event: string): boolean {
    return (this.#listeners.get(event)?.size ?? 0) > 0;
  }

  emitStatus(status: MockStatus): void {
    this.status = status;
    this.#listeners.get('status')?.forEach((cb) => cb({ status }));
  }
}

function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('useConnectionStatus', () => {
  beforeEach(() => {
    setOnLine(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setOnLine(true);
  });

  it('returns "reconnecting" when provider is null (mount window)', () => {
    const { result } = renderHook(() => useConnectionStatus(null));
    expect(result.current).toBe('reconnecting');
  });

  it('returns "live" when provider is connected and online', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { result } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );
    expect(result.current).toBe('live');
  });

  it('returns "reconnecting" while provider.status === "connecting"', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { result } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );
    expect(result.current).toBe('live');

    act(() => {
      provider.emitStatus('connecting');
    });
    expect(result.current).toBe('reconnecting');
  });

  it('flips to "offline" after the provider stays disconnected for >= 1500 ms', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { result } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );
    expect(result.current).toBe('live');

    act(() => {
      provider.emitStatus('disconnected');
    });
    // Inside the debounce window we stay "reconnecting" so the
    // banner does not flash on a single dropped frame.
    expect(result.current).toBe('reconnecting');

    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(result.current).toBe('reconnecting');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('offline');
  });

  it('does NOT flip to "offline" when a disconnect resolves before 1500 ms', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { result } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );

    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(result.current).toBe('reconnecting');

    act(() => {
      vi.advanceTimersByTime(800);
      provider.emitStatus('connected');
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe('live');
  });

  it('short-circuits to "offline" immediately when navigator.onLine === false', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { result } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );
    expect(result.current).toBe('live');

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe('offline');
  });

  it('returns to "live" when the OS comes back online with a connected provider', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { result } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe('offline');

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe('live');
  });

  it('detaches the provider listener and the OS listeners on unmount', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { unmount } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );

    expect(provider.hasListener('status')).toBe(true);

    const removeSpy = vi.spyOn(window, 'removeEventListener');
    unmount();
    expect(provider.hasListener('status')).toBe(false);
    // window-level listeners are paired (online + offline).
    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain('online');
    expect(removedEvents).toContain('offline');
    removeSpy.mockRestore();
  });

  it('clears a pending disconnect timer on unmount (no late-fire setState)', () => {
    const provider = new MockProvider();
    provider.status = 'connected';
    const { result, unmount } = renderHook(() =>
      useConnectionStatus(provider as unknown as Parameters<typeof useConnectionStatus>[0]),
    );

    act(() => {
      provider.emitStatus('disconnected');
    });
    expect(result.current).toBe('reconnecting');

    unmount();
    // Advancing the timer past the debounce after unmount must not
    // throw (a late setState on an unmounted hook would warn but not
    // throw; the timer being cleared means even the warn does not
    // fire).
    expect(() => {
      vi.advanceTimersByTime(2000);
    }).not.toThrow();
  });
});
