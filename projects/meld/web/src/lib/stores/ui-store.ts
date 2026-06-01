'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI store — process-local UI state that survives a reload.
 *
 * Single field in v1: `themePreference`. next-themes is the authoritative
 * driver of the actual `data-theme` attribute on `<html>`; this store
 * mirrors the user's stated preference so non-React code (e.g., the
 * presence layer in Phase 3, future board-side awareness selectors that
 * want to react to theme without hooking into next-themes) can read the
 * preference without subscribing to React.
 *
 * Persistence key: `meld-ui-v1`. Bumping to `meld-ui-v2` would discard
 * the field — keep the major suffix in sync with breaking schema
 * changes here, not with marketing version bumps.
 *
 * Why Zustand for one field? Phase 2.5+ adds: tool-palette selection,
 * cursor-trail visibility toggle, presence-name-pill density, and
 * whether the (Phase 3.6) Cmd+Shift+D dev-overlay is open. Each lands
 * here as new fields and the persist key stays stable. This module is
 * the v1 floor.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * Connection-state machine driven by ADR-009.
 *
 *   - `'live'`         — provider is connected AND the OS reports
 *                        online. The default + the dominant state.
 *   - `'reconnecting'` — provider is mid-handshake. Flap window of up
 *                        to 1500 ms after a `disconnected` event is
 *                        ALSO collapsed into this bucket so the banner
 *                        does NOT flash on a single dropped frame.
 *   - `'offline'`      — provider has been `disconnected` for ≥ 1500
 *                        ms OR `navigator.onLine === false`. Banner
 *                        + aria-live announcement fire on entry.
 */
export type ConnectionState = 'live' | 'reconnecting' | 'offline';

interface UiState {
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  /**
   * Dev-only — Cmd+Shift+D / Ctrl+Shift+D toggles the conflict-viz
   * overlay (Phase 2.6 / ADR-008). The field exists on the store
   * shape unconditionally (a Zustand state shape cannot be
   * conditionally typed without breaking selector inference), but
   * the consumer component is gated by `process.env.NODE_ENV ===
   * 'development'` AND its body opens with the same gate so Terser
   * DCEs the module in production builds. NOT persisted — the
   * overlay state resets on reload, which matches dev-only ergonomics.
   */
  showConflictViz: boolean;
  setShowConflictViz: (open: boolean) => void;
  toggleConflictViz: () => void;
  /**
   * Phase 3.4 / ADR-009 — connection-state machine driving the
   * `<ConnectionBanner />`, the `<OfflineAriaLiveRegion />`, and the
   * shape-canvas crossfade gate. `<BoardCanvasHost />` is the only
   * writer; consumer components subscribe with a selector and read.
   *
   * NOT persisted — connection state is transient (a reload would
   * stale-rehydrate `'offline'` on a healthy connection).
   */
  connectionState: ConnectionState;
  setConnectionState: (state: ConnectionState) => void;
  /**
   * The reconcile delta — count of shapes that materialised between
   * the start of the most recent offline window and the moment we
   * came back live. Drives:
   *   - the crossfade gate (`> 0` triggers the 200 ms opacity dip on
   *     the shape canvas; `=== 0` skips the animation entirely),
   *   - the aria-live announcement copy variant ("N shapes synced" vs
   *     "Connection restored.").
   *
   * Reset to `null` on a fresh offline transition so a second
   * disconnect → reconnect cycle does not inherit the previous
   * delta. NOT persisted.
   */
  lastReconcileMs: number | null;
  recordReconcile: (count: number) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themePreference: 'light',
      setThemePreference: (preference) => {
        set({ themePreference: preference });
      },
      showConflictViz: false,
      setShowConflictViz: (open) => {
        set({ showConflictViz: open });
      },
      toggleConflictViz: () => {
        set((state) => ({ showConflictViz: !state.showConflictViz }));
      },
      connectionState: 'live',
      setConnectionState: (state) => {
        set({ connectionState: state });
      },
      lastReconcileMs: null,
      recordReconcile: (count) => {
        set({ lastReconcileMs: count });
      },
    }),
    {
      name: 'meld-ui-v1',
      // Persist only the user-facing preference. Functions are not
      // round-trippable through JSON.stringify and would replay as
      // `undefined` on rehydrate, silently shadowing the live setter.
      // `showConflictViz`, `connectionState`, and `lastReconcileMs`
      // are transient session state — also excluded.
      partialize: (state) => ({ themePreference: state.themePreference }),
    },
  ),
);
