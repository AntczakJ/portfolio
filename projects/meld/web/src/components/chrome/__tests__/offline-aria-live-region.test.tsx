import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OfflineAriaLiveRegion } from '../offline-aria-live-region';
import { useUiStore } from '@/lib/stores/ui-store';

/**
 * Tests for `<OfflineAriaLiveRegion />` — Phase 3.4 / ADR-009 assertive
 * announcement region.
 *
 *   Coverage:
 *     1. Mount with `connectionState === 'live'` → empty region (no
 *        spurious initial announcement).
 *     2. Transition `live → offline` → emits the verbatim offline copy.
 *     3. Transition `offline → live` with N=0 → "Connection restored."
 *     4. Transition `offline → live` with N=1 → "Connection restored. 1 shape synced."
 *     5. Transition `offline → live` with N=2 → "Connection restored. 2 shapes synced."
 *     6. Region carries role="status" + aria-live="assertive" +
 *        aria-atomic="true" + sr-only class.
 *
 *   Verbatim ADR-009 copy variants — DO NOT paraphrase.
 */

const COPY_OFFLINE =
  'Offline. Your edits are saved locally and will sync when the connection returns.';
const COPY_OVERRUN =
  "Connection paused — you're editing too fast. Reconnecting shortly. Your work is saved.";
const COPY_RESTORED_BARE = 'Connection restored.';

function resetUiStore(): void {
  useUiStore.setState({
    connectionState: 'live',
    lastReconcileMs: null,
    overrunRetryMs: null,
  });
}

function getRegion(container: HTMLElement): HTMLElement {
  const node = container.querySelector('[role="status"]');
  if (node === null) throw new Error('region not found');
  return node as HTMLElement;
}

describe('<OfflineAriaLiveRegion />', () => {
  beforeEach(() => {
    resetUiStore();
  });

  afterEach(() => {
    cleanup();
    resetUiStore();
  });

  it('renders with role="status", aria-live="assertive", aria-atomic="true", and sr-only class', () => {
    const { container } = render(<OfflineAriaLiveRegion />);
    const region = getRegion(container);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('assertive');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.className).toContain('sr-only');
  });

  it('starts empty when mounted in the "live" state', () => {
    const { container } = render(<OfflineAriaLiveRegion />);
    const region = getRegion(container);
    expect(region.textContent).toBe('');
  });

  it('emits the verbatim offline copy on live → offline', () => {
    const { container } = render(<OfflineAriaLiveRegion />);

    act(() => {
      useUiStore.setState({ connectionState: 'offline' });
    });
    const region = getRegion(container);
    expect(region.textContent).toBe(COPY_OFFLINE);
  });

  it('emits the bare restored copy when N=0', () => {
    const { container } = render(<OfflineAriaLiveRegion />);

    act(() => {
      useUiStore.setState({ connectionState: 'offline' });
    });
    act(() => {
      useUiStore.setState({
        connectionState: 'live',
        lastReconcileMs: 0,
      });
    });
    const region = getRegion(container);
    expect(region.textContent).toBe(COPY_RESTORED_BARE);
  });

  it('emits the singular "1 shape synced" copy when N=1', () => {
    const { container } = render(<OfflineAriaLiveRegion />);

    act(() => {
      useUiStore.setState({ connectionState: 'offline' });
    });
    act(() => {
      useUiStore.setState({
        connectionState: 'live',
        lastReconcileMs: 1,
      });
    });
    const region = getRegion(container);
    expect(region.textContent).toBe('Connection restored. 1 shape synced.');
  });

  it('emits the plural "N shapes synced" copy when N>=2', () => {
    const { container } = render(<OfflineAriaLiveRegion />);

    act(() => {
      useUiStore.setState({ connectionState: 'offline' });
    });
    act(() => {
      useUiStore.setState({
        connectionState: 'live',
        lastReconcileMs: 5,
      });
    });
    const region = getRegion(container);
    expect(region.textContent).toBe('Connection restored. 5 shapes synced.');
  });

  // ADR-010 — overrun announcement + its restore.
  it('emits the overrun copy on * → overrun', () => {
    const { container } = render(<OfflineAriaLiveRegion />);

    act(() => {
      useUiStore.setState({ connectionState: 'overrun' });
    });
    const region = getRegion(container);
    expect(region.textContent).toBe(COPY_OVERRUN);
  });

  it('emits the restored copy on overrun → live (same path as offline restore)', () => {
    const { container } = render(<OfflineAriaLiveRegion />);

    act(() => {
      useUiStore.setState({ connectionState: 'overrun' });
    });
    act(() => {
      useUiStore.setState({ connectionState: 'live', lastReconcileMs: 2 });
    });
    const region = getRegion(container);
    expect(region.textContent).toBe('Connection restored. 2 shapes synced.');
  });

  it('stays silent on intermediate transitions (live → reconnecting → live)', () => {
    const { container } = render(<OfflineAriaLiveRegion />);

    act(() => {
      useUiStore.setState({ connectionState: 'reconnecting' });
    });
    act(() => {
      useUiStore.setState({ connectionState: 'live' });
    });
    const region = getRegion(container);
    expect(region.textContent).toBe('');
  });
});
