/**
 * <WorkerStatus /> unit coverage (ADR-004 worker-offline indicator).
 *
 * Covers:
 *   - renders nothing (empty live region) while the worker is available
 *   - surfaces the "Cells paused — worker restarting" copy when the store
 *     flips to `unavailable` via a `control.worker_unavailable` frame
 *   - clears the copy on `control.worker_ready`
 *   - the live region is `aria-live="polite"` (informational, not an
 *     error — must not be assertive)
 *
 * The component reads the real `useStreamStore`; we drive it through the
 * same `ingestFrame` reducer the WS provider uses, so this exercises the
 * store seam + the UI together.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WorkerStatus } from '../worker-status';
import { useStreamStore } from '@/lib/stores/stream-store';
import type { WSFrame } from 'tape-server';

function workerUnavailableFrame(): WSFrame {
  return {
    topic: 'control',
    kind: 'control.worker_unavailable',
    payload: { reason: 'crash', serverTsMs: 1_780_000_000_000 },
  };
}

function workerReadyFrame(): WSFrame {
  return {
    topic: 'control',
    kind: 'control.worker_ready',
    payload: { generation: 1, serverTsMs: 1_780_000_000_500 },
  };
}

const PAUSED_COPY = 'Cells paused — worker restarting';

afterEach(() => {
  cleanup();
  act(() => {
    useStreamStore.getState().resetSession();
  });
});

describe('<WorkerStatus />', () => {
  it('renders no indicator copy while the worker is available', () => {
    render(<WorkerStatus />);
    expect(screen.queryByText(PAUSED_COPY)).toBeNull();
  });

  it('uses a polite (not assertive) live region', () => {
    const { container } = render(<WorkerStatus />);
    const region = container.querySelector('[aria-live]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });

  it('surfaces the paused copy when worker_unavailable arrives', () => {
    render(<WorkerStatus />);
    act(() => {
      useStreamStore.getState().ingestFrame(workerUnavailableFrame());
    });
    expect(screen.getByText(PAUSED_COPY)).not.toBeNull();
  });

  it('clears the paused copy when worker_ready arrives', () => {
    render(<WorkerStatus />);
    act(() => {
      useStreamStore.getState().ingestFrame(workerUnavailableFrame());
    });
    expect(screen.getByText(PAUSED_COPY)).not.toBeNull();
    act(() => {
      useStreamStore.getState().ingestFrame(workerReadyFrame());
    });
    expect(screen.queryByText(PAUSED_COPY)).toBeNull();
  });

  it('reflects the availability on the live region data attribute', () => {
    const { container } = render(<WorkerStatus />);
    expect(
      container.querySelector('[data-worker-status="available"]'),
    ).not.toBeNull();
    act(() => {
      useStreamStore.getState().ingestFrame(workerUnavailableFrame());
    });
    expect(
      container.querySelector('[data-worker-status="unavailable"]'),
    ).not.toBeNull();
  });
});
