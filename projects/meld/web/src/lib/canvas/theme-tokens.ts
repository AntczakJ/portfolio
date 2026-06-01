/* -------------------------------------------------------------------------
 * Theme tokens bridge for the Phase 2.6 Canvas2D board surface (ADR-008).
 *
 * WHY NOT TAILWIND CLASSES
 *   Canvas2D does not participate in CSS. Its drawing API takes string
 *   colors via `fillStyle` / `strokeStyle` and never sees `class="bg-..."`
 *   utilities. The shape engine + cursor engine (Phase 3.2 / 3.3) need
 *   the raw computed color value for each token at draw time — not a
 *   Tailwind class name. Per `docs/conventions.md` § 14 these tokens
 *   stay inside `meld`; no extraction to a shared package.
 *
 * GETCOMPUTEDSTYLE + MUTATIONOBSERVER
 *   1. Tokens are declared in `app/globals.css` under `@theme` (light
 *      canonical) and `:root[data-theme='dark']` (dark overrides).
 *   2. At runtime we read each token via
 *      `getComputedStyle(document.documentElement).getPropertyValue(name)`
 *      and cache the result. The Canvas2D engines pull from the cache
 *      every paint — zero re-read cost per frame.
 *   3. A `MutationObserver` watches `documentElement`'s `data-theme`
 *      attribute (the `next-themes` attribute strategy). On a flip we
 *      re-read every token, compare to the last snapshot, and notify
 *      subscribers only if any token actually changed.
 *   4. Each engine subscribes ONCE and flips its own dirty flag inside
 *      the callback. The React shell does NOT re-render per frame —
 *      the engine instances live outside React's reconciler.
 *
 * SUBSCRIBE-ONCE CONTRACT
 *   `getThemeTokensBridge()` returns a process-wide singleton on the
 *   client. Both the shape engine and the cursor engine subscribe to
 *   the same bridge — do NOT instantiate a second `MutationObserver`
 *   per engine. The bridge fans out to all subscribers; each engine
 *   flips its own dirty flag inside its callback.
 *
 * SSR FALLBACK POLICY
 *   `getThemeTokensBridge()` on the server returns a stub whose
 *   `current()` THROWS. Canvas2D never runs SSR, so any direct bridge
 *   call from the server is a bug we want to surface loudly rather
 *   than silently paint a fallback. `<BoardCanvasHost />` is
 *   `'use client'` and constructs the bridge inside `useEffect`, so
 *   the stub is never reached in practice.
 *
 * Pattern mirrors tape's `web/src/lib/theme/tokens.ts` verbatim — the
 * helper is a PATTERN, not a token (per § 14, patterns are allowed to
 * port across projects, tokens are not). Token names are sovereign to
 * meld; pattern shape is shared.
 * --------------------------------------------------------------------- */

/**
 * Token names this bridge tracks. The source of truth for `globals.css`
 * is the CSS file itself; this tuple is the source of truth for *which*
 * tokens the bridge reads. Adding a new canvas-relevant token means
 * extending both `globals.css` and this tuple.
 *
 * Order is irrelevant for correctness — the snapshot is keyed by name.
 * Grouped by purpose for human scanability: canvas surface, foreground,
 * awareness wheel slots (0-7), accent.
 */
export const THEME_TOKENS = [
  // Canvas surfaces.
  '--color-bg',
  '--color-surface',
  '--color-border',
  // Foreground (used by future text-label shapes + cursor name pills).
  '--color-fg',
  '--color-fg-muted',
  '--color-fg-subtle',
  // Brand accent (used by future selection chrome + brand-anchor cursor).
  '--color-accent',
  // Awareness wheel — 8 slots, per ADR-005 + AGENT_NOTES Task 2.1.
  // Order matches `colorSlotFor(sessionId, boardId)` indexing on the
  // server side (slot 0 = brand violet anchor, then 45° around the
  // wheel through magenta / warm-red / amber / olive / emerald / teal
  // / indigo). The cursor engine (Phase 3.3) will index by slot.
  '--color-awareness-0',
  '--color-awareness-1',
  '--color-awareness-2',
  '--color-awareness-3',
  '--color-awareness-4',
  '--color-awareness-5',
  '--color-awareness-6',
  '--color-awareness-7',
] as const;

export type ThemeTokenName = (typeof THEME_TOKENS)[number];

export type ThemeTokensSnapshot = Readonly<Record<ThemeTokenName, string>>;

export type ThemeTokensSubscriber = (snapshot: ThemeTokensSnapshot) => void;

/**
 * Server-side fallback. Mirrors the light-theme `@theme` block in
 * `globals.css` verbatim. If `globals.css` changes a light value, change
 * it here too. There is no runtime synchronisation — these are read
 * once on the server per request, and the client takes over after
 * hydration via the live bridge.
 *
 * Used ONLY by the React adapter hook (none yet — Phase 3.2's selection
 * chrome will introduce one). The Canvas2D engines never reach SSR.
 */
const SSR_FALLBACK_TOKENS: ThemeTokensSnapshot = /*#__PURE__*/ Object.freeze({
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

function isBrowser(): boolean {
  return typeof document !== 'undefined';
}

/**
 * Read every tracked token from `documentElement`'s computed style. The
 * raw `getPropertyValue` string (e.g., `"oklch(0.6 0.17 285)"`) is
 * usable directly as a Canvas2D `fillStyle` / `strokeStyle`. Throws if
 * any token is missing — a typo in `THEME_TOKENS` or a deleted CSS
 * declaration should crash loudly in dev, not silently paint black.
 */
export function readThemeTokens(): ThemeTokensSnapshot {
  if (!isBrowser()) {
    throw new Error(
      'readThemeTokens() called on the server. Canvas2D never runs SSR; ' +
        'this call site is a bug. Push the call behind a useEffect or a ' +
        "'use client' boundary.",
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
 * tracked token changes. See module header for rationale.
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
    // Watch both `data-theme` (next-themes attribute strategy) and the
    // legacy `class` attribute (some themes flip a `.dark` class as
    // well — defence in depth, costs nothing).
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
   * Callback receives the new snapshot; for Canvas2D consumers the
   * snapshot is read directly and used as `fillStyle` / `strokeStyle`.
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
   * so test code can force a re-read without waiting for a real
   * mutation event.
   */
  refresh(): void {
    this.#refresh();
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
 * sites do not need a `typeof window` branch. `current()` THROWS on
 * the server because Canvas2D never runs SSR; `subscribe()` /
 * `refresh()` / `dispose()` are real no-ops for any React adapter
 * that legitimately exercises them under `useSyncExternalStore`'s
 * SSR pass.
 */
const SSR_NOOP_UNSUBSCRIBE = (): void => {};

class ThemeTokensBridgeStub {
  current(): ThemeTokensSnapshot {
    throw new Error(
      'ThemeTokensBridge.current() called on the server. The Canvas2D ' +
        'engines never run SSR — this call site is a bug.',
    );
  }
  subscribe(): () => void {
    return SSR_NOOP_UNSUBSCRIBE;
  }
  refresh(): void {}
  dispose(): void {}
}

let cached: ThemeTokensBridge | ThemeTokensBridgeStub | null = null;

/**
 * Lazy singleton accessor. On the server returns a stub; on the client
 * returns a concrete `ThemeTokensBridge`. Idempotent — repeated calls
 * return the same instance per environment.
 *
 * Both canvas engines + the dev conflict-viz overlay consume the same
 * singleton — do NOT duplicate the `MutationObserver` per engine.
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
 * `getThemeTokensBridge()` call rebuilds (used between Vitest cases
 * to isolate the `MutationObserver` lifecycle). Not part of the
 * production surface — the runtime never resets the bridge.
 */
export function __resetThemeTokensBridgeForTests(): void {
  if (cached && 'dispose' in cached) {
    cached.dispose();
  }
  cached = null;
}

export { SSR_FALLBACK_TOKENS };
