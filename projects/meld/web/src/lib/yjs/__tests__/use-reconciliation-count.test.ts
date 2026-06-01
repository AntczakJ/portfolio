import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { useReconciliationCount } from '../use-reconciliation-count';
import type { ConnectionState } from '@/lib/stores/ui-store';

/**
 * Tests for `useReconciliationCount` — Phase 3.4 / ADR-009 reconcile
 * delta hook.
 *
 *   Contract:
 *     - Continuous tracking of `doc.getMap('shapes').size`.
 *     - On `live → offline` transition: capture baseline, reset delta to 0.
 *     - On `offline → live` transition: compute delta = current − baseline,
 *       clamp negatives to 0.
 *     - Null doc → 0.
 */

function addShape(doc: Y.Doc, id: string): void {
  const shapes = doc.getMap('shapes');
  shapes.set(id, { id, type: 'rectangle' });
}

function removeShape(doc: Y.Doc, id: string): void {
  const shapes = doc.getMap('shapes');
  shapes.delete(id);
}

describe('useReconciliationCount', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  afterEach(() => {
    doc.destroy();
  });

  it('returns 0 when the doc is null', () => {
    const { result } = renderHook(() =>
      useReconciliationCount({ doc: null, connectionState: 'live' }),
    );
    expect(result.current).toBe(0);
  });

  it('returns 0 while live with no transition history', () => {
    addShape(doc, 'a');
    addShape(doc, 'b');
    const { result } = renderHook(() =>
      useReconciliationCount({ doc, connectionState: 'live' }),
    );
    expect(result.current).toBe(0);
  });

  it('captures baseline on live → offline and surfaces the delta on offline → live', () => {
    addShape(doc, 'a');
    addShape(doc, 'b');

    const { result, rerender } = renderHook(
      ({ connectionState }: { connectionState: ConnectionState }) =>
        useReconciliationCount({ doc, connectionState }),
      { initialProps: { connectionState: 'live' as ConnectionState } },
    );
    expect(result.current).toBe(0);

    // Enter offline — baseline captured at 2.
    rerender({ connectionState: 'offline' });
    expect(result.current).toBe(0);

    // Two shapes added while offline (simulating a remote peer that
    // kept drawing).
    act(() => {
      addShape(doc, 'c');
      addShape(doc, 'd');
    });

    // Coming back live — delta = current (4) − baseline (2) = 2.
    rerender({ connectionState: 'live' });
    expect(result.current).toBe(2);
  });

  it('emits N=1 for a single incoming shape (singular copy gate)', () => {
    const { result, rerender } = renderHook(
      ({ connectionState }: { connectionState: ConnectionState }) =>
        useReconciliationCount({ doc, connectionState }),
      { initialProps: { connectionState: 'live' as ConnectionState } },
    );

    rerender({ connectionState: 'offline' });
    act(() => {
      addShape(doc, 'only');
    });
    rerender({ connectionState: 'live' });
    expect(result.current).toBe(1);
  });

  it('emits N=0 when no shapes arrived during the offline window', () => {
    addShape(doc, 'a');
    const { result, rerender } = renderHook(
      ({ connectionState }: { connectionState: ConnectionState }) =>
        useReconciliationCount({ doc, connectionState }),
      { initialProps: { connectionState: 'live' as ConnectionState } },
    );

    rerender({ connectionState: 'offline' });
    // No shapes added.
    rerender({ connectionState: 'live' });
    expect(result.current).toBe(0);
  });

  it('clamps negative deltas (peers deleted shapes while we were offline) to 0', () => {
    addShape(doc, 'a');
    addShape(doc, 'b');
    addShape(doc, 'c');

    const { result, rerender } = renderHook(
      ({ connectionState }: { connectionState: ConnectionState }) =>
        useReconciliationCount({ doc, connectionState }),
      { initialProps: { connectionState: 'live' as ConnectionState } },
    );

    rerender({ connectionState: 'offline' });
    act(() => {
      removeShape(doc, 'a');
      removeShape(doc, 'b');
    });
    rerender({ connectionState: 'live' });
    expect(result.current).toBe(0);
  });

  it('resets baseline on a fresh offline cycle', () => {
    const { result, rerender } = renderHook(
      ({ connectionState }: { connectionState: ConnectionState }) =>
        useReconciliationCount({ doc, connectionState }),
      { initialProps: { connectionState: 'live' as ConnectionState } },
    );

    // Cycle 1.
    rerender({ connectionState: 'offline' });
    act(() => {
      addShape(doc, 'a');
    });
    rerender({ connectionState: 'live' });
    expect(result.current).toBe(1);

    // Cycle 2 — should compute a fresh baseline (current is 1 shape).
    rerender({ connectionState: 'offline' });
    expect(result.current).toBe(0);
    act(() => {
      addShape(doc, 'b');
      addShape(doc, 'c');
      addShape(doc, 'd');
    });
    rerender({ connectionState: 'live' });
    expect(result.current).toBe(3);
  });

  it('ignores intermediate reconnecting transitions', () => {
    const { result, rerender } = renderHook(
      ({ connectionState }: { connectionState: ConnectionState }) =>
        useReconciliationCount({ doc, connectionState }),
      { initialProps: { connectionState: 'live' as ConnectionState } },
    );

    rerender({ connectionState: 'offline' });
    act(() => {
      addShape(doc, 'a');
    });
    rerender({ connectionState: 'reconnecting' });
    // reconnecting → live without an intermediate offline must NOT
    // surface a delta (no offline → live transition happened).
    rerender({ connectionState: 'live' });
    expect(result.current).toBe(0);
  });
});
