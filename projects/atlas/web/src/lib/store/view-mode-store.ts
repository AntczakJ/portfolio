import { create } from 'zustand';

/**
 * View-mode store (Task 6.1 — the graceful-degradation matrix, no-WebGL arm).
 *
 * The operations surface can be shown two ways:
 *   - `map`   — the live MapLibre canvas (the wow surface, viewer 1's lead),
 *   - `table` — the full-width first-class fleet table (the same live data from
 *               the same socket; the keyboard/SR path AND the no-WebGL fallback).
 *
 * Two inputs decide which renders:
 *
 *   1. `webglAvailable` — a CAPABILITY probe (set once on mount from
 *      `isWebglAvailable()`, or flipped to false if `webglcontextlost` fires and
 *      cannot be restored). When WebGL is absent the map CANNOT render, so the
 *      table is forced regardless of the user preference.
 *
 *   2. `preference` — a USER toggle: `auto` (follow capability — map when WebGL
 *      is present), or an explicit `map` / `table`. The table is a first-class
 *      CHOICE, not only an error fallback (PLAN.md success criterion: "togglable
 *      by any user"). An explicit `map` preference is still overridden to table
 *      when WebGL is genuinely unavailable (we cannot honour the impossible).
 *
 * `effectiveView` resolves the two into the surface that actually renders. Kept a
 * pure selector so the dashboard reads one value.
 *
 * This is low-frequency UI chrome state (it changes a handful of times), so React
 * state via Zustand is correct here — it never touches the per-frame map path.
 */

export type ViewPreference = 'auto' | 'map' | 'table';
export type EffectiveView = 'map' | 'table';

interface ViewModeState {
  /** Capability probe: can the browser render the WebGL map at all. */
  webglAvailable: boolean;
  /** True once the capability probe has run (client-only — SSR renders neutral). */
  probed: boolean;
  /** The user's explicit preference (default: follow capability). */
  preference: ViewPreference;
  setWebglAvailable: (available: boolean) => void;
  setPreference: (preference: ViewPreference) => void;
}

export const useViewModeStore = create<ViewModeState>((set) => ({
  webglAvailable: true,
  probed: false,
  preference: 'auto',
  setWebglAvailable: (available) => {
    set({ webglAvailable: available, probed: true });
  },
  setPreference: (preference) => {
    set({ preference });
  },
}));

/** Resolve the preference + capability into the surface that actually renders. */
export function resolveEffectiveView(
  preference: ViewPreference,
  webglAvailable: boolean,
): EffectiveView {
  // Capability wins: no WebGL → the table, whatever the preference asks for.
  if (!webglAvailable) return 'table';
  if (preference === 'table') return 'table';
  // 'auto' or explicit 'map' with WebGL present → the map.
  return 'map';
}
