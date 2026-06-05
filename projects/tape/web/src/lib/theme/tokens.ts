/* -------------------------------------------------------------------------
 * Theme tokens bridge for the Phase 3 Canvas2D footprint renderer.
 *
 * WHY NOT TAILWIND CLASSES
 *   Canvas2D does not participate in CSS. Its drawing API takes string
 *   colors via `fillStyle` / `strokeStyle` and never sees `class="bg-..."`
 *   utilities. The renderer therefore needs the raw computed color value
 *   for each cell-related theme token at draw time — not a Tailwind
 *   class name. Per docs/conventions.md § 14 these tokens stay inside
 *   `tape`; no extraction to a shared package.
 *
 * GETCOMPUTEDSTYLE + MUTATIONOBSERVER
 *   1. Tokens are declared in `app/globals.css` under `@theme` (dark
 *      canonical) and `:root[data-theme='light']` (light overrides).
 *   2. At runtime we read each token via
 *      `getComputedStyle(document.documentElement).getPropertyValue(name)`
 *      and cache the result. The Canvas2D render loop pulls from the
 *      cache every frame — zero re-read cost per draw.
 *   3. A MutationObserver watches `documentElement`'s `data-theme`
 *      attribute (the next-themes attribute strategy, see
 *      `src/app/providers.tsx`). On a flip we re-read every token,
 *      compare to the last snapshot, and notify subscribers only if any
 *      token actually changed.
 *   4. The chart's React shell does NOT re-render per frame — it
 *      subscribes directly to the bridge and triggers a single repaint
 *      when the snapshot swaps. The React adapter in
 *      `use-theme-tokens.ts` is for chrome consumers (axis labels,
 *      tooltip readouts) that legitimately want React to re-render.
 *
 * SSR FALLBACK POLICY
 *   `getThemeTokensBridge()` on the server returns a stub whose
 *   `current()` THROWS. Canvas2D never runs SSR, so any direct bridge
 *   call from the server is a bug we want to surface loudly rather
 *   than silently paint a fallback. The React adapter hook
 *   (`use-theme-tokens.ts`) does NOT go through the stub on SSR — it
 *   returns the hard-coded dark fallback (`SSR_FALLBACK_TOKENS`)
 *   directly from `getServerSnapshot`, mirroring the next-themes
 *   `defaultTheme="system"` server-render default (the initial HTML
 *   always carries the dark palette in `@theme`). Hydration takes
 *   over on the client and the MutationObserver picks up any actual
 *   theme flip from there. Splitting the two surfaces — bridge
 *   throws on SSR, React hook uses a literal fallback — keeps the
 *   hot-path bridge strict while preserving a coherent SSR markup
 *   for any chrome consumers that want a token value rendered into
 *   server HTML.
 *
 * OKLCH VALUES (snapshot at Task 2.5 ship — source of truth is
 * `app/globals.css`; this list is a comment, NOT a runtime fallback
 * beyond `SSR_FALLBACK_TOKENS`):
 *
 *   token                         dark                              light
 *   ----                          ----                              -----
 *   --color-bid                   oklch(0.74 0.16 155)              oklch(0.5 0.16 155)
 *   --color-ask                   oklch(0.7 0.2 28)                 oklch(0.55 0.2 28)
 *   --color-delta-up              oklch(0.8 0.18 150)               oklch(0.46 0.18 150)
 *   --color-delta-down            oklch(0.72 0.2 25)                oklch(0.5 0.2 25)
 *   --color-grid                  oklch(0.27 0.012 250)             oklch(0.9 0.006 100)
 *   --color-cell-bg               oklch(0.19 0.013 250)             oklch(0.955 0.006 100)
 *   --color-cell-bg-strong        oklch(0.4 0.04 220)               oklch(0.78 0.04 220)
 *   --color-cell-fg               oklch(0.94 0.005 250)             oklch(0.22 0.015 250)
 *   --color-cell-fg-subtle        oklch(0.62 0.012 250)             oklch(0.48 0.014 250)
 *   --color-cell-imbalance-buy    oklch(0.72 0.2 152)               oklch(0.48 0.18 152)
 *   --color-cell-imbalance-sell   oklch(0.68 0.22 28)               oklch(0.52 0.22 28)
 *   --color-cell-imbalance-neutral oklch(0.45 0.012 250)            oklch(0.78 0.01 100)
 *   --color-cell-stroke           oklch(0.24 0.012 250)             oklch(0.92 0.006 100)
 *   --color-cell-cursor           oklch(0.82 0.16 195)              oklch(0.5 0.18 200)
 *   --color-cell-cursor-glow      oklch(0.82 0.16 195 / 0.25)       oklch(0.5 0.18 200 / 0.18)
 *   --color-axis-tick             oklch(0.38 0.012 250)             oklch(0.76 0.008 100)
 *   --color-axis-label            oklch(0.7 0.012 250)              oklch(0.42 0.014 250)
 * --------------------------------------------------------------------- */

/**
 * Token names this bridge tracks. The source of truth for `globals.css`
 * is the CSS file itself; this tuple is the source of truth for *which*
 * tokens the bridge reads. Adding a new chart-relevant token means
 * extending both `globals.css` and this tuple (one place to update so a
 * typo in either surfaces as a typecheck error or a `readThemeTokens`
 * runtime throw).
 *
 * Order is irrelevant for correctness. Grouped by purpose for human
 * scanability: cell fill, cell text, imbalance gradient, cursor, axis,
 * plus the pre-existing footprint primitives.
 */
export const THEME_TOKENS = [
  // Pre-existing (Task 2.1).
  '--color-bid',
  '--color-ask',
  '--color-delta-up',
  '--color-delta-down',
  '--color-grid',
  // Chart background — pulled into the bridge by Task 3.1 so the
  // Canvas2D paintBackground pass can read it via the same
  // mechanism as the rest of the cell palette. Not a new token: the
  // declaration has been in globals.css since Task 2.1.
  '--color-bg',
  // Cell fill (Task 2.5).
  '--color-cell-bg',
  '--color-cell-bg-strong',
  // Cell text (Task 2.5).
  '--color-cell-fg',
  '--color-cell-fg-subtle',
  // Imbalance gradient anchors (Task 2.5).
  '--color-cell-imbalance-buy',
  '--color-cell-imbalance-sell',
  '--color-cell-imbalance-neutral',
  // Cell stroke (Task 2.5).
  '--color-cell-stroke',
  // Cursor (Task 2.5).
  '--color-cell-cursor',
  '--color-cell-cursor-glow',
  // Axis (Task 2.5).
  '--color-axis-tick',
  '--color-axis-label',
  // Monospace font family (Phase 4.1 P0-3). The Canvas2D `ctx.font`
  // shorthand parser CANNOT resolve a CSS custom property — a string
  // like `10px var(--font-mono)` silently falls back to the platform
  // default mono, so the chosen JetBrains Mono never paints and the
  // canvas digits mismatch the DOM tape (which DOES resolve the var via
  // CSS). We read the COMPUTED `--font-mono` value here, once per theme
  // flip, and feed the concrete family list literally into every
  // `ctx.font` assignment. `--font-mono` does not change across themes,
  // but routing it through the same snapshot keeps every painter reading
  // one source of truth.
  '--font-mono',
] as const;

export type ThemeTokenName = (typeof THEME_TOKENS)[number];

export type ThemeTokensSnapshot = Readonly<Record<ThemeTokenName, string>>;

export type ThemeTokensSubscriber = (snapshot: ThemeTokensSnapshot) => void;

/**
 * SSR fallback. The next-themes provider defaults to `system` and the
 * initial server HTML carries the dark palette from `@theme` — so on
 * the server we return the dark values verbatim. These mirror the
 * `@theme` block; if `globals.css` changes a dark value, change it here
 * too. There is no runtime synchronisation — these are read once on
 * the server per request, and the client takes over after hydration.
 */
const SSR_FALLBACK_TOKENS: ThemeTokensSnapshot = /*#__PURE__*/ Object.freeze({
  '--color-bid': 'oklch(0.74 0.16 155)',
  '--color-ask': 'oklch(0.7 0.2 28)',
  '--color-delta-up': 'oklch(0.8 0.18 150)',
  '--color-delta-down': 'oklch(0.72 0.2 25)',
  '--color-grid': 'oklch(0.27 0.012 250)',
  '--color-bg': 'oklch(0.16 0.012 250)',
  '--color-cell-bg': 'oklch(0.19 0.013 250)',
  '--color-cell-bg-strong': 'oklch(0.4 0.04 220)',
  '--color-cell-fg': 'oklch(0.94 0.005 250)',
  '--color-cell-fg-subtle': 'oklch(0.62 0.012 250)',
  '--color-cell-imbalance-buy': 'oklch(0.72 0.2 152)',
  '--color-cell-imbalance-sell': 'oklch(0.68 0.22 28)',
  '--color-cell-imbalance-neutral': 'oklch(0.45 0.012 250)',
  '--color-cell-stroke': 'oklch(0.24 0.012 250)',
  '--color-cell-cursor': 'oklch(0.82 0.16 195)',
  '--color-cell-cursor-glow': 'oklch(0.82 0.16 195 / 0.25)',
  '--color-axis-tick': 'oklch(0.38 0.012 250)',
  '--color-axis-label': 'oklch(0.7 0.012 250)',
  // Mirrors the `--font-mono` declaration in globals.css. The Canvas2D
  // render loop never runs SSR, so this literal is only ever consumed
  // by the React adapter's getServerSnapshot — the browser bridge
  // re-reads the computed value after hydration.
  '--font-mono':
    "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Monaco, " +
    "'Cascadia Mono', Consolas, 'Courier New', monospace",
});

function isBrowser(): boolean {
  return typeof document !== 'undefined';
}

/**
 * Read every tracked token from `documentElement`'s computed style. The
 * raw `getPropertyValue` string (e.g., `"oklch(0.78 0.16 195)"`) is
 * usable directly as a Canvas2D `fillStyle` / `strokeStyle`. Throws if
 * any token is missing — a typo in `THEME_TOKENS` or a deleted CSS
 * declaration should crash loudly in dev, not silently paint black.
 */
export function readThemeTokens(): ThemeTokensSnapshot {
  if (!isBrowser()) {
    throw new Error(
      'readThemeTokens() called on the server. Use the React adapter ' +
        'hook for SSR-safe access; the bare reader is browser-only.',
    );
  }
  const style = window.getComputedStyle(document.documentElement);
  const snapshot: Partial<Record<ThemeTokenName, string>> = {};
  for (const token of THEME_TOKENS) {
    const raw = style.getPropertyValue(token).trim();
    if (raw === '') {
      throw new Error(
        `Theme token "${token}" is empty on documentElement computed ` +
          'style. Did you typo the name or delete the declaration in ' +
          'globals.css?',
      );
    }
    snapshot[token] = raw;
  }
  return Object.freeze(snapshot as Record<ThemeTokenName, string>);
}

function snapshotsEqual(
  a: ThemeTokensSnapshot,
  b: ThemeTokensSnapshot,
): boolean {
  for (const token of THEME_TOKENS) {
    if (a[token] !== b[token]) return false;
  }
  return true;
}

/**
 * Browser-only bridge. Holds the current snapshot, observes
 * `data-theme` flips on documentElement, notifies subscribers when any
 * tracked token changes. See module header for the rationale and the
 * SSR fallback policy.
 */
export class ThemeTokensBridge {
  #snapshot: ThemeTokensSnapshot;
  #subscribers = new Set<ThemeTokensSubscriber>();
  #observer: MutationObserver | null = null;

  constructor() {
    if (!isBrowser()) {
      throw new Error(
        'ThemeTokensBridge constructed on the server. Use ' +
          '`getThemeTokensBridge()` which returns an SSR-safe stub ' +
          'instead of touching this class directly.',
      );
    }
    this.#snapshot = readThemeTokens();
    this.#observer = new MutationObserver(() => {
      this.#refresh();
    });
    this.#observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
  }

  current(): ThemeTokensSnapshot {
    return this.#snapshot;
  }

  /**
   * Subscribe to snapshot changes. Returns an unsubscribe function.
   * The callback receives the new snapshot; for Canvas2D consumers
   * the snapshot is read directly and used as `fillStyle`.
   */
  subscribe(callback: ThemeTokensSubscriber): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  /**
   * Re-read every token and notify subscribers if anything changed.
   * Called on every observed `data-theme` mutation. Exposed publicly
   * so test code or a debug console can force a re-read without
   * waiting for a mutation event.
   */
  refresh(): void {
    this.#refresh();
  }

  /**
   * Force-notify subscribers with the current snapshot, even when no
   * token string actually changed (Task 5.4 follow-up — web-font load).
   *
   * WHY THIS EXISTS, SEPARATE FROM `refresh()`
   *   With `display: 'optional'` the JetBrains Mono file may not be
   *   ready on the very first canvas paint. The computed `--font-mono`
   *   STRING value does NOT change when the file finishes loading (it is
   *   the same family-name list the whole time), so `#refresh()` would
   *   short-circuit on `snapshotsEqual` and never notify — yet the
   *   Canvas2D `ctx.font` still needs a repaint to actually RENDER with
   *   the now-loaded glyphs instead of the fallback. This method re-reads
   *   the snapshot (cheap, keeps the cache fresh) and notifies every
   *   subscriber unconditionally so the chart engine flips dirty and
   *   re-paints once `document.fonts.ready` resolves. No layout shift —
   *   the DOM box geometry is unchanged; only the canvas glyph pixels
   *   upgrade.
   */
  forceNotify(): void {
    this.#snapshot = readThemeTokens();
    for (const sub of this.#subscribers) {
      sub(this.#snapshot);
    }
  }

  dispose(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#subscribers.clear();
  }

  #refresh(): void {
    const next = readThemeTokens();
    if (snapshotsEqual(this.#snapshot, next)) return;
    this.#snapshot = next;
    for (const sub of this.#subscribers) {
      sub(next);
    }
  }
}

/**
 * SSR stub. Mirrors the public shape of `ThemeTokensBridge` so call
 * sites do not need a `typeof window` branch at the call site — but
 * `current()` THROWS on the server because Canvas2D never runs SSR
 * and any chart code path that ends up here is a bug we want to
 * surface loudly. The React adapter hook side-steps this by reading
 * `SSR_FALLBACK_TOKENS` from `getServerSnapshot` directly; only
 * `subscribe()` / `refresh()` / `dispose()` are real no-ops because
 * those are legitimately exercised by the React hook's SSR pass
 * (`useSyncExternalStore` subscribes during render).
 *
 * The browser instance replaces this stub on the first
 * `getThemeTokensBridge()` call after hydration.
 */
const SSR_NOOP_UNSUBSCRIBE = (): void => {};

class ThemeTokensBridgeStub {
  current(): ThemeTokensSnapshot {
    throw new Error(
      'ThemeTokensBridge.current() called on the server. The Canvas2D ' +
        'render loop never runs SSR — this call site is a bug. Use the ' +
        '`useThemeTokens()` React adapter (SSR-safe via getServerSnapshot) ' +
        'or push the call behind a useEffect / browser-only code path.',
    );
  }
  subscribe(): () => void {
    return SSR_NOOP_UNSUBSCRIBE;
  }
  refresh(): void {}
  forceNotify(): void {}
  dispose(): void {}
}

let cached: ThemeTokensBridge | ThemeTokensBridgeStub | null = null;

/**
 * Lazy singleton accessor. On the server returns a stub whose
 * `current()` yields the dark fallback. On the client returns a
 * concrete `ThemeTokensBridge`. Idempotent — repeated calls return
 * the same instance per environment.
 */
export function getThemeTokensBridge():
  | ThemeTokensBridge
  | ThemeTokensBridgeStub {
  if (cached) return cached;
  cached = isBrowser() ? new ThemeTokensBridge() : new ThemeTokensBridgeStub();
  return cached;
}

/**
 * Test-only escape hatch. Drops the cached singleton so the next
 * `getThemeTokensBridge()` call rebuilds (e.g., after JSDOM teardown
 * in a Vitest suite). Not part of the production surface — the
 * runtime never resets the bridge.
 */
export function __resetThemeTokensBridgeForTests(): void {
  if (cached && 'dispose' in cached) {
    cached.dispose();
  }
  cached = null;
}

export { SSR_FALLBACK_TOKENS };
