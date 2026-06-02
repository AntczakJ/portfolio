/**
 * Overrun dispatch test — ADR-010 §2.
 *
 * Exercises the parse → ui-store dispatch the `useOverrunHandler`
 * `onUnknownControlFrame` callback performs, WITHOUT a live
 * `HocuspocusProvider` (the provider disconnect/reconnect cycle is a
 * browser-integration concern the main thread owns). We assert:
 *
 *   - an overrun frame flips `connectionState` to `'overrun'` and stashes
 *     the (clamped) `retryAfterMs`,
 *   - a non-overrun frame leaves the store untouched (the handler
 *     ignores it),
 *   - `clearOverrun` clears the retry hint.
 *
 * This mirrors the handler's logic: `parseOverrunFrame(raw)` → on a
 * non-null result `useUiStore.getState().setOverrun(retryAfterMs)`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useUiStore } from '@/lib/stores/ui-store';

import { parseOverrunFrame } from '../overrun';

/**
 * The exact dispatch the `useOverrunHandler` callback runs (minus the
 * provider disconnect/reconnect, which is integration-tested live).
 */
function dispatchControlFrame(raw: unknown): boolean {
  const frame = parseOverrunFrame(raw);
  if (frame === null) return false;
  useUiStore.getState().setOverrun(frame.retryAfterMs);
  return true;
}

function reset(): void {
  useUiStore.setState({
    connectionState: 'live',
    overrunRetryMs: null,
    lastReconcileMs: null,
  });
}

describe('overrun dispatch → ui-store', () => {
  beforeEach(reset);
  afterEach(reset);

  it('flips connectionState to "overrun" and stores the retry hint', () => {
    const handled = dispatchControlFrame({
      kind: 'control.overrun',
      reason: 'rate.exceeded',
      closeCode: 4290,
      retryAfterMs: 1500,
    });
    expect(handled).toBe(true);
    expect(useUiStore.getState().connectionState).toBe('overrun');
    expect(useUiStore.getState().overrunRetryMs).toBe(1500);
  });

  it('clamps a hostile retry value before storing it', () => {
    dispatchControlFrame({
      kind: 'control.overrun',
      reason: 'queue.overflow',
      retryAfterMs: 10_000_000,
    });
    expect(useUiStore.getState().overrunRetryMs).toBeLessThanOrEqual(30_000);
  });

  it('ignores a non-overrun control frame (store untouched)', () => {
    const handled = dispatchControlFrame({ kind: 'welcome', session: {} });
    expect(handled).toBe(false);
    expect(useUiStore.getState().connectionState).toBe('live');
    expect(useUiStore.getState().overrunRetryMs).toBeNull();
  });

  it('clearOverrun resets the retry hint', () => {
    dispatchControlFrame({ kind: 'control.overrun', retryAfterMs: 1500 });
    expect(useUiStore.getState().overrunRetryMs).toBe(1500);
    useUiStore.getState().clearOverrun();
    expect(useUiStore.getState().overrunRetryMs).toBeNull();
  });
});
