import { cleanup, render, screen } from '@testing-library/react';
import type * as MotionReact from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionBanner } from '../connection-banner';
import { useUiStore } from '@/lib/stores/ui-store';

/**
 * Tests for `<ConnectionBanner />` — Phase 3.4 / ADR-009 offline notice.
 *
 *   Coverage:
 *     1. `connectionState: 'offline'` → banner visible with verbatim
 *        copy + lucide WifiOff icon + role="status" + aria-live="polite".
 *     2. `connectionState: 'live'` → banner NOT visible.
 *     3. `connectionState: 'reconnecting'` → banner NOT visible (flap
 *        suppression per ADR-009).
 *     4. Token-driven palette — className references `--color-warning-*`
 *        tokens.
 *
 *   Reduced-motion is exercised via the `useReducedMotion` mock; the
 *   component renders identically in both branches (the difference is
 *   `duration: 0` vs animated, which is a Motion-internal detail we
 *   do not assert on the DOM).
 *
 *   We use bare expects rather than `@testing-library/jest-dom` matchers
 *   because the meld-web suite has no jest-dom dep — consistent with
 *   the rest of the harness (see `use-awareness.test.ts`).
 */

const BANNER_COPY = 'Offline — your edits will sync when you reconnect';
const OVERRUN_COPY = 'Slow down — reconnecting in a moment…';

function resetUiStore(): void {
  useUiStore.setState({
    connectionState: 'live',
    lastReconcileMs: null,
    overrunRetryMs: null,
  });
}

// Mock `useReducedMotion` to `false` by default — jsdom does not fully
// implement matchMedia in a way Motion's reduced-motion hook trusts.
vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof MotionReact>('motion/react');
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

describe('<ConnectionBanner />', () => {
  beforeEach(() => {
    resetUiStore();
  });

  afterEach(() => {
    cleanup();
    resetUiStore();
    vi.clearAllMocks();
  });

  it('does not render when connectionState is "live"', () => {
    useUiStore.setState({ connectionState: 'live' });
    render(<ConnectionBanner />);
    expect(screen.queryByText(BANNER_COPY)).toBeNull();
  });

  it('does not render when connectionState is "reconnecting" (flap suppression)', () => {
    useUiStore.setState({ connectionState: 'reconnecting' });
    render(<ConnectionBanner />);
    expect(screen.queryByText(BANNER_COPY)).toBeNull();
  });

  it('renders the verbatim ADR-009 copy when connectionState is "offline"', () => {
    useUiStore.setState({ connectionState: 'offline' });
    render(<ConnectionBanner />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(BANNER_COPY);
  });

  it('exposes role="status" + aria-live="polite" on the banner', () => {
    useUiStore.setState({ connectionState: 'offline' });
    render(<ConnectionBanner />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('renders the lucide WifiOff icon next to the copy', () => {
    useUiStore.setState({ connectionState: 'offline' });
    const { container } = render(<ConnectionBanner />);
    // lucide-react ships an inline SVG; WifiOff's class contains
    // `wifi-off` (lowercase, kebab) — the lib's deterministic class
    // naming.
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect((icon?.getAttribute('class') ?? '').toLowerCase()).toContain(
      'wifi-off',
    );
  });

  it('uses the --color-warning-* tokens for surface, border, foreground', () => {
    useUiStore.setState({ connectionState: 'offline' });
    render(<ConnectionBanner />);
    const status = screen.getByRole('status');
    // Tailwind v4 emits `bg-(--color-warning-surface)` etc as
    // utility classes. jsdom does not run the CSS layer so we assert
    // on the className containing the token references.
    expect(status.className).toContain('bg-(--color-warning-surface)');
    expect(status.className).toContain('border-(--color-warning-border)');
    expect(status.className).toContain('text-(--color-warning-foreground)');
  });

  // ADR-010 — the overrun (`4290`) state reuses this banner surface.
  it('renders the overrun copy when connectionState is "overrun"', () => {
    useUiStore.setState({ connectionState: 'overrun' });
    render(<ConnectionBanner />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(OVERRUN_COPY);
    // It must NOT show the offline copy.
    expect(status.textContent).not.toContain(BANNER_COPY);
  });

  it('renders the lucide Gauge icon (not WifiOff) in the overrun state', () => {
    useUiStore.setState({ connectionState: 'overrun' });
    const { container } = render(<ConnectionBanner />);
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    const cls = (icon?.getAttribute('class') ?? '').toLowerCase();
    expect(cls).toContain('gauge');
    expect(cls).not.toContain('wifi-off');
  });
});
