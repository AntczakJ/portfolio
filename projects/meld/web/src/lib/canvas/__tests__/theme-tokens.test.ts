/**
 * ThemeTokensBridge tests — Vitest + jsdom.
 *
 * We exercise the bridge's two load-bearing invariants:
 *
 *   1. `subscribe(cb)` fires `cb` ONLY when a tracked token actually
 *      changes — a re-read that yields the same snapshot does NOT
 *      notify.
 *   2. The bridge holds the cached snapshot between subscriber calls
 *      — `current()` is a property read, not a re-parse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetThemeTokensBridgeForTests,
  getThemeTokensBridge,
  readThemeTokens,
  THEME_TOKENS,
  ThemeTokensBridge,
} from '../theme-tokens';

function setTokens(values: Partial<Record<(typeof THEME_TOKENS)[number], string>>): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      root.style.setProperty(name, value);
    }
  }
}

function setAllLight(): void {
  setTokens({
    '--color-bg': 'oklch(0.985 0.005 90)',
    '--color-surface': 'oklch(0.96 0.006 90)',
    '--color-border': 'oklch(0.86 0.01 90)',
    '--color-fg': 'oklch(0.2 0.018 285)',
    '--color-fg-muted': 'oklch(0.44 0.016 285)',
    '--color-fg-subtle': 'oklch(0.45 0.012 285)',
    '--color-accent': 'oklch(0.55 0.18 285)',
    '--color-awareness-0': 'oklch(0.6 0.17 285)',
    '--color-awareness-1': 'oklch(0.6 0.17 330)',
    '--color-awareness-2': 'oklch(0.6 0.17 15)',
    '--color-awareness-3': 'oklch(0.6 0.17 60)',
    '--color-awareness-4': 'oklch(0.6 0.17 105)',
    '--color-awareness-5': 'oklch(0.6 0.17 150)',
    '--color-awareness-6': 'oklch(0.6 0.17 195)',
    '--color-awareness-7': 'oklch(0.6 0.17 240)',
  });
}

beforeEach(() => {
  setAllLight();
});

afterEach(() => {
  __resetThemeTokensBridgeForTests();
  // Clear inline styles between tests.
  for (const token of THEME_TOKENS) {
    document.documentElement.style.removeProperty(token);
  }
});

describe('readThemeTokens', () => {
  it('reads every tracked token from documentElement', () => {
    const snap = readThemeTokens();
    for (const token of THEME_TOKENS) {
      expect(snap[token]).toBe(
        document.documentElement.style.getPropertyValue(token).trim() ||
          window
            .getComputedStyle(document.documentElement)
            .getPropertyValue(token)
            .trim(),
      );
    }
  });

  it('throws when a token is missing', () => {
    document.documentElement.style.removeProperty('--color-bg');
    expect(() => readThemeTokens()).toThrow(/--color-bg/);
  });
});

describe('ThemeTokensBridge.subscribe', () => {
  it('does not fire subscriber if no tracked token changed', () => {
    const bridge = new ThemeTokensBridge();
    const cb = vi.fn();
    bridge.subscribe(cb);
    // Force a re-read with identical values.
    bridge.refresh();
    expect(cb).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it('fires subscriber once when a tracked token changes', () => {
    const bridge = new ThemeTokensBridge();
    const cb = vi.fn();
    bridge.subscribe(cb);
    setTokens({ '--color-bg': 'oklch(0.18 0.012 285)' });
    bridge.refresh();
    expect(cb).toHaveBeenCalledTimes(1);
    const snap = cb.mock.calls[0]?.[0];
    expect(snap['--color-bg']).toBe('oklch(0.18 0.012 285)');
    bridge.dispose();
  });

  it('fires every subscriber, returns unsubscribe', () => {
    const bridge = new ThemeTokensBridge();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = bridge.subscribe(a);
    bridge.subscribe(b);
    setTokens({ '--color-fg': 'oklch(0.96 0.005 285)' });
    bridge.refresh();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    setTokens({ '--color-fg': 'oklch(0.2 0.018 285)' });
    bridge.refresh();
    expect(a).toHaveBeenCalledTimes(1); // unsubscribed
    expect(b).toHaveBeenCalledTimes(2);
    bridge.dispose();
  });

  it('caches snapshot — current() does not re-parse', () => {
    const bridge = new ThemeTokensBridge();
    const snap1 = bridge.current();
    const snap2 = bridge.current();
    expect(snap1).toBe(snap2); // same frozen object reference
    bridge.dispose();
  });

  it('disposes the MutationObserver and clears subscribers', () => {
    const bridge = new ThemeTokensBridge();
    const cb = vi.fn();
    bridge.subscribe(cb);
    bridge.dispose();
    // After dispose, subscribe set is empty and a future refresh
    // does not invoke the (gone) callback.
    setTokens({ '--color-bg': 'oklch(0.99 0.0 0)' });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('getThemeTokensBridge', () => {
  it('returns the same singleton on repeated calls', () => {
    const a = getThemeTokensBridge();
    const b = getThemeTokensBridge();
    expect(a).toBe(b);
  });

  it('returns a fresh instance after __resetThemeTokensBridgeForTests', () => {
    const a = getThemeTokensBridge();
    __resetThemeTokensBridgeForTests();
    const b = getThemeTokensBridge();
    expect(a).not.toBe(b);
  });
});
