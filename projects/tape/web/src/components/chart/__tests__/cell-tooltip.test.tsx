/**
 * <CellTooltip /> unit coverage (Phase 3.2).
 *
 * Covers:
 *   - subscribes on mount, unsubscribes on unmount
 *   - renders the right values for a known cursor cell
 *   - hides when no cursor (style.opacity = 0, visibility hidden)
 *   - aria-live + aria-atomic present so SR announces cell changes
 *   - clampToContainer pure-function rule (default placement, flip
 *     horizontally, flip vertically, last-resort clamp)
 *
 * We mount the tooltip inside a `FootprintEngineProvider` with a
 * tiny fake engine that exposes only the surface the hook reads:
 * `subscribeCursor`. This keeps the spec focused on the React layer
 * rather than re-testing the engine's own state machine (covered in
 * `lib/chart/__tests__/cursor.test.ts`).
 */
import '@/lib/chart/__tests__/canvas-mock';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { CellTooltip, clampToContainer } from '../cell-tooltip';
import { FootprintEngineProvider } from '@/lib/chart/engine-context';
import type {
  CursorSubscriberState,
  FootprintChartEngine,
} from '@/lib/chart/footprint-engine';

/** Minimal subscriber-only fake — `useFootprintCursor` only calls
 * `subscribeCursor`. We do NOT implement the rest of the engine
 * surface; if the hook ever reaches for more, this test fails loudly. */
class FakeEngine {
  #subs = new Set<(s: CursorSubscriberState | null) => void>();

  subscribeCursor(cb: (s: CursorSubscriberState | null) => void): () => void {
    this.#subs.add(cb);
    cb(null);
    return () => {
      this.#subs.delete(cb);
    };
  }
  emit(state: CursorSubscriberState | null): void {
    for (const s of this.#subs) s(state);
  }
  subCount(): number {
    return this.#subs.size;
  }
}

function Harness({
  engine,
}: {
  engine: FakeEngine;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  return (
    <FootprintEngineProvider
      engine={engine as unknown as FootprintChartEngine}
    >
      <div
        ref={containerRef}
        data-testid="chart-container"
        style={{ position: 'relative', width: 800, height: 600 }}
      >
        <CellTooltip containerRef={containerRef} />
      </div>
    </FootprintEngineProvider>
  );
}

afterEach(() => {
  // Vitest does NOT auto-cleanup RTL renders the way Jest's
  // `setupFilesAfterEach` does — call cleanup explicitly so each
  // test gets a fresh DOM.
  cleanup();
});

describe('<CellTooltip />', () => {
  it('subscribes on mount and unsubscribes on unmount', () => {
    const engine = new FakeEngine();
    const { unmount } = render(<Harness engine={engine} />);
    expect(engine.subCount()).toBe(1);
    unmount();
    expect(engine.subCount()).toBe(0);
  });

  it('renders cell readout when cursor moves over a recorded cell', () => {
    const engine = new FakeEngine();
    render(<Harness engine={engine} />);

    // `priceBucket` is an INDEX, not USD — INDEX 14_201 × $5 = $71,005.
    // The tooltip multiplies by DEFAULT_PRICE_BUCKET_SIZE and formats
    // as USD currency so the user reads `$71,005.00`, not the raw
    // internal index. See the docblock on the engine's
    // DEFAULT_PRICE_BUCKET_SIZE export.
    act(() => {
      engine.emit({
        px: { x: 200, y: 200 },
        cell: { bucketTs: 1_780_000_000_000, priceBucket: 14_201 },
        data: {
          bucketTs: 1_780_000_000_000,
          priceBucket: 14_201,
          bidVolume: 3.5,
          askVolume: 7.5,
          trades: 42,
        },
      });
    });

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toContain('$71,005.00');
    expect(status.textContent).toContain('3.50');
    expect(status.textContent).toContain('7.50');
    expect(status.textContent).toContain('42');
    // Delta = ask - bid = +4.00, positive → +4.00 sign present.
    expect(status.textContent).toContain('+4.00');
    // Imbalance = (ask - bid) / total = 4/11 ≈ 0.3636 → +36.4%.
    expect(status.textContent).toContain('+36.4%');
  });

  it('renders zero-state values when cursor is over an empty cell', () => {
    const engine = new FakeEngine();
    render(<Harness engine={engine} />);

    // INDEX 14_220 × $5 = $71,100.
    act(() => {
      engine.emit({
        px: { x: 200, y: 200 },
        cell: { bucketTs: 1_780_000_060_000, priceBucket: 14_220 },
        data: null,
      });
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('$71,100.00');
    // No cell — imbalance is rendered as em-dash placeholder.
    expect(status.textContent).toContain('—');
  });

  it('hides (opacity 0 + visibility hidden) when cursor is null', () => {
    const engine = new FakeEngine();
    const { container } = render(<Harness engine={engine} />);

    // visibility: hidden takes role="status" out of the accessibility
    // tree, so getByRole('status') reports it as missing. Query by
    // attribute selector directly — exactly what the SR contract
    // promises (aria-live="polite" on the floating panel).
    const status = container.querySelector<HTMLElement>(
      '[aria-label="Cell readout"]',
    );
    if (status === null) throw new Error('tooltip element missing');
    expect(status.style.opacity).toBe('0');
    expect(status.style.visibility).toBe('hidden');

    act(() => {
      engine.emit({
        px: { x: 50, y: 50 },
        cell: { bucketTs: 1_780_000_000_000, priceBucket: 71_000 },
        data: null,
      });
    });
    expect(status.style.opacity).toBe('1');
    expect(status.style.visibility).toBe('visible');

    act(() => {
      engine.emit(null);
    });
    expect(status.style.opacity).toBe('0');
    expect(status.style.visibility).toBe('hidden');
  });
});

describe('clampToContainer', () => {
  const base = {
    containerW: 800,
    containerH: 600,
    tooltipW: 180,
    tooltipH: 120,
  };

  it('default placement: lower-right of cursor with offset', () => {
    const pos = clampToContainer({
      ...base,
      cursorX: 100,
      cursorY: 100,
    });
    // Default offset is 14 + 14.
    expect(pos.left).toBe(114);
    expect(pos.top).toBe(114);
  });

  it('flips horizontally when right-anchored would overflow', () => {
    const pos = clampToContainer({
      ...base,
      cursorX: 780,
      cursorY: 100,
    });
    // Would land at 780 + 14 = 794, plus tooltipW 180 → overflow at
    // containerW 800. Flip → left = cursorX - 14 - 180 = 586.
    expect(pos.left).toBe(586);
  });

  it('flips vertically when bottom-anchored would overflow', () => {
    const pos = clampToContainer({
      ...base,
      cursorX: 100,
      cursorY: 580,
    });
    // 580 + 14 + 120 = 714 > 600 → flip. top = 580 - 14 - 120 = 446.
    expect(pos.top).toBe(446);
  });

  it('flips both axes when bottom-right corner overflows', () => {
    const pos = clampToContainer({
      ...base,
      cursorX: 780,
      cursorY: 580,
    });
    expect(pos.left).toBe(586);
    expect(pos.top).toBe(446);
  });

  it('last-resort clamp pins to margin when tooltip wider than container', () => {
    // Tooltip wider than container → cannot fit horizontally; clamp
    // pins left at VIEWPORT_MARGIN and accepts the right-edge overflow
    // rather than producing a negative coord. Vertical placement is
    // unconstrained here (150 < 200) so the default lower-right
    // offset applies.
    const pos = clampToContainer({
      cursorX: 5,
      cursorY: 5,
      containerW: 200,
      containerH: 200,
      tooltipW: 300, // wider than container
      tooltipH: 150,
    });
    expect(pos.left).toBe(12); // pinned to margin (cannot fit horizontally)
    expect(pos.top).toBe(19); // cursorY 5 + CURSOR_OFFSET_Y 14
  });
});
