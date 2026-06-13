import { cleanup, render, screen } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as MotionReact from 'motion/react';

import { IdentityBadgeClient } from '../identity-badge-client';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { InitialIdentity } from '@/lib/identity/use-identity';
import { useWelcomeStore } from '@/lib/stores/welcome-store';

function renderBadge(
  initial: InitialIdentity | null,
): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <IdentityBadgeClient initial={initial} />
    </TooltipProvider>,
  );
}

/**
 * Tests for `<IdentityBadgeClient />` â€” Phase 4.3 D-02 fix.
 *
 * The previous motion target was a no-op `opacity: 1 â†’ 1` animation
 * and a CSS `transition-colors` fallback. The fix swaps that for a
 * Motion `borderColor` ramp + `scale` 0.97 â†’ 1 beat with the Material
 * decel curve `[0.16, 1, 0.3, 1]` over 280 ms â€” fires once on
 * `welcome === null â†’ welcome === resolved`.
 *
 * Strategy: capture the props handed to Motion's `motion.span` by
 * mocking `motion/react` and asserting on the recorded `animate` +
 * `transition` + `initial` props of the ring element.
 */

interface CapturedMotionProps {
  initial?: unknown;
  animate?: unknown;
  transition?: unknown;
}

/**
 * Props handed to the mocked `motion.<tag>` factory. Motion-only keys
 * are picked out for capture / stripping; everything else is forwarded
 * to the underlying DOM element via `createElement`.
 */
interface MotionTagProps extends CapturedMotionProps {
  'aria-hidden'?: string;
  [key: string]: unknown;
}

const capturedRingProps: CapturedMotionProps[] = [];

vi.mock('motion/react', async () => {
  const actual =
    await vi.importActual<typeof MotionReact>('motion/react');
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
    motion: new Proxy(
      {},
      {
        get(_target, tag: string) {
          return function MotionTag(props: MotionTagProps): ReactElement {
            // Only the ring carries the welcome-arrival beat. The
            // ring uses `motion.span` with `aria-hidden="true"`.
            if (tag === 'span' && props['aria-hidden'] === 'true') {
              capturedRingProps.push({
                initial: props.initial,
                animate: props.animate,
                transition: props.transition,
              });
            }
            // Strip Motion-only props before passing through to a
            // plain DOM element so Testing Library sees a normal
            // tree.
            const {
              initial: _initial,
              animate: _animate,
              transition: _transition,
              ...rest
            } = props;
            return createElement(tag, rest);
          };
        },
      },
    ),
  };
});

const INITIAL: InitialIdentity = {
  id: '4d520148-aaaa-bbbb-cccc-1234567890ab',
  emojiChar: '\u{1F98A}',
  emojiName: 'fox',
};

function resetWelcomeStore(): void {
  useWelcomeStore.setState({ welcome: null });
}

describe('<IdentityBadgeClient /> Phase 4.3 D-02 motion shape', () => {
  beforeEach(() => {
    resetWelcomeStore();
    capturedRingProps.length = 0;
  });

  afterEach(() => {
    cleanup();
    resetWelcomeStore();
    vi.clearAllMocks();
  });

  it('renders the badge with the initial identity name pre-welcome', () => {
    renderBadge(INITIAL);
    expect(screen.getByText('fox')).not.toBeNull();
  });

  it('animates the ring with the 280 ms Material decel curve and scale 1', () => {
    renderBadge(INITIAL);
    // The ring is the only motion.span with aria-hidden="true".
    expect(capturedRingProps.length).toBeGreaterThanOrEqual(1);
    const props = capturedRingProps[capturedRingProps.length - 1];
    expect(props).toBeDefined();
    const transition = props?.transition as {
      duration?: number;
      ease?: readonly number[];
    };
    // 280 ms = 0.28 s
    expect(transition.duration).toBeCloseTo(0.28, 3);
    // Material decel curve.
    expect(Array.from(transition.ease ?? [])).toEqual([0.16, 1, 0.3, 1]);
    const animate = props?.animate as {
      scale?: number;
      borderColor?: string;
    };
    expect(animate.scale).toBe(1);
    expect(typeof animate.borderColor).toBe('string');
  });

  it('targets the welcome-resolved OKLCH border color when welcome arrives', () => {
    // Simulate the welcome having arrived BEFORE first render â€”
    // the same flow as session-rotate where the store already has
    // a welcome at provider construction time.
    useWelcomeStore.setState({
      welcome: {
        kind: 'welcome',
        protocolVersion: 1,
        origin: 'http://localhost:3000',
        serverTime: Date.now(),
        session: {
          id: INITIAL.id,
          emojiChar: INITIAL.emojiChar,
          emojiName: INITIAL.emojiName,
          color: { L: 0.6, C: 0.17, H: 285 },
          colorDark: { L: 0.72, C: 0.17, H: 285 },
          mintedAt: 'cookie',
        },
        board: {
          id: 'b1',
          createdAt: Date.now(),
          connectionCount: 1,
        },
      } as never,
    });
    renderBadge(INITIAL);
    const props = capturedRingProps[capturedRingProps.length - 1];
    const animate = props?.animate as { borderColor?: string };
    // Resolved OKLCH triple â†’ `oklch(0.600 0.170 285.00)` rendered.
    expect(animate.borderColor).toContain('oklch(');
    expect(animate.borderColor).toContain('285');
  });

  it('drops to instant transition under prefers-reduced-motion', async () => {
    const motionModule = await import('motion/react');
    (motionModule.useReducedMotion as unknown as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(true);
    renderBadge(INITIAL);
    const props = capturedRingProps[capturedRingProps.length - 1];
    const transition = props?.transition as { duration?: number };
    expect(transition.duration).toBe(0);
  });
});
