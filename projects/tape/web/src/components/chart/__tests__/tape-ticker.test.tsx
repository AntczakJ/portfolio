/**
 * <TapeTicker /> unit coverage (Task 3.3).
 *
 * Covers:
 *   - empty state before any ticks arrive
 *   - newest-first ordering of rows
 *   - aggressor colour + directional glyph (colour-never-alone)
 *   - screen-reader side label present per row
 *   - click-to-pin surfaces the pinned banner; clicking the same row
 *     again toggles it off; the unpin control clears it
 *
 * The component consumes the real Zustand stream store via
 * `useRecentTicks(...)`, so the test drives the store directly with
 * `ingestFrame(tick)` rather than mocking the selector — that exercises
 * the 3.4 -> 3.3 seam end to end.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TapeTicker } from '../tape-ticker';
import { useStreamStore } from '@/lib/stores/stream-store';
import type { WSFrame, WSTickPayload } from 'tape-server';

// jsdom lacks ResizeObserver; the virtualizer measures viewport height
// through it. A no-op stub is enough — the test asserts on rendered
// rows, not on the exact scroll window.
class FakeResizeObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

function makeTick(overrides: Partial<WSTickPayload> = {}): WSTickPayload {
  return {
    tsMs: 1_780_000_000_000,
    price: 71_000,
    qty: 0.5,
    aggressor: 'buy',
    ...overrides,
  };
}

function tickFrame(payload: WSTickPayload): WSFrame {
  return { topic: 'ticks.btc', kind: 'tick', payload };
}

function pushTicks(ticks: WSTickPayload[]): void {
  act(() => {
    const store = useStreamStore.getState();
    for (const t of ticks) store.ingestFrame(tickFrame(t));
  });
}

/** Strict-safe first-element access — throws (failing the test) rather
 * than reaching for a non-null assertion the root ESLint config bans. */
function first<T>(items: T[]): T {
  const item = items.at(0);
  if (item === undefined) throw new Error('expected at least one element');
  return item;
}

describe('<TapeTicker />', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    useStreamStore.getState().resetSession();
  });

  afterEach(() => {
    cleanup();
    useStreamStore.getState().resetSession();
    vi.unstubAllGlobals();
  });

  it('shows the empty state before any ticks arrive', () => {
    render(<TapeTicker />);
    expect(screen.getByText(/first trades arrive/i)).toBeTruthy();
  });

  it('renders trades newest-first', () => {
    pushTicks([
      makeTick({ tsMs: 1_780_000_000_000, price: 71_001 }),
      makeTick({ tsMs: 1_780_000_001_000, price: 71_002 }),
      makeTick({ tsMs: 1_780_000_002_000, price: 71_003 }),
    ]);
    render(<TapeTicker />);
    const list = screen.getByRole('list', { name: /newest first/i });
    const rows = within(list).getAllByRole('listitem');
    // Newest (71003) must appear before older prices in DOM order.
    const text = rows.map((r) => r.textContent).join('|');
    expect(text.indexOf('71,003')).toBeLessThan(text.indexOf('71,002'));
    expect(text.indexOf('71,002')).toBeLessThan(text.indexOf('71,001'));
  });

  it('pairs colour with a directional glyph and an SR side label', () => {
    pushTicks([
      makeTick({ tsMs: 1_780_000_000_000, price: 71_010, aggressor: 'buy' }),
      makeTick({ tsMs: 1_780_000_001_000, price: 71_020, aggressor: 'sell' }),
    ]);
    render(<TapeTicker />);
    // Buy -> ▲ + "Buy" SR label; Sell -> ▼ + "Sell" SR label.
    expect(screen.getByText('▲')).toBeTruthy();
    expect(screen.getByText('▼')).toBeTruthy();
    expect(screen.getByText('Buy')).toBeTruthy();
    expect(screen.getByText('Sell')).toBeTruthy();
  });

  it('click-to-pin surfaces a pinned banner and toggles off on re-click', () => {
    pushTicks([makeTick({ tsMs: 1_780_000_000_000, price: 71_050, qty: 1.25 })]);
    render(<TapeTicker />);
    const list = screen.getByRole('list', { name: /newest first/i });
    const row = first(within(list).getAllByRole('button'));
    expect(screen.queryByLabelText(/unpin trade/i)).toBeNull();
    fireEvent.click(row);
    // Pinned banner with an Unpin control appears.
    expect(screen.getByLabelText(/unpin trade/i)).toBeTruthy();
    expect(screen.getByText(/pinned/i)).toBeTruthy();
    // Re-clicking the same row toggles the pin off.
    fireEvent.click(row);
    expect(screen.queryByLabelText(/unpin trade/i)).toBeNull();
  });

  it('the unpin control clears the pinned banner', () => {
    pushTicks([makeTick({ tsMs: 1_780_000_000_000, price: 71_060 })]);
    render(<TapeTicker />);
    const list = screen.getByRole('list', { name: /newest first/i });
    const row = first(within(list).getAllByRole('button'));
    fireEvent.click(row);
    const unpin = screen.getByLabelText(/unpin trade/i);
    fireEvent.click(unpin);
    expect(screen.queryByLabelText(/unpin trade/i)).toBeNull();
  });
});
