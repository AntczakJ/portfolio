'use client';

import { create } from 'zustand';
import { persist, type PersistOptions } from 'zustand/middleware';

import type { ShapeKind, ToolKind } from '@/lib/shapes/kinds';
import { isToolKind } from '@/lib/shapes/kinds';

/**
 * Tool store — toolbar's currently-active tool (Phase 3.2).
 *
 * Two fields:
 *
 *   - `tool`         — the active toolbar mode. One of `'select'`,
 *                      `'rectangle'`, `'ellipse'`, `'freehand'`,
 *                      `'text'`. The pointer overlay in
 *                      `<BoardCanvasHost />` reads this to dispatch
 *                      pointer events.
 *   - `lastUsedTool` — the most recent DRAWING tool (never `'select'`).
 *                      `Escape` short-circuits the tool back to
 *                      `'select'`; pressing the same key as the last
 *                      tool toggles back. Phase 3.2b's selection chrome
 *                      uses this for the "back to drawing" CTA.
 *
 * Persist key: `meld:tool` (version 1). Bumping to version 2 throws
 * away the persisted value via `migrate: () => initial()`. The
 * `partialize` excludes the setters — Zustand persist serialises every
 * field including functions, and a function round-tripped through
 * JSON.stringify becomes `undefined`, silently shadowing the live
 * setter on rehydrate.
 *
 * Default tool: `'select'`. PLAN.md positions the demo's first action
 * as the share / open-second-tab CTA, not "draw a rectangle" — the
 * user lands on the board with no tool armed and explicitly picks
 * one. The `R` keyboard shortcut covers the power-user path.
 */

interface ToolStoreState {
  tool: ToolKind;
  lastUsedTool: ShapeKind;
  setTool: (next: ToolKind) => void;
  revertToLast: () => void;
}

/**
 * Persist key — the `meld:` prefix matches the Zustand-store convention
 * the connection-store + welcome-store (future) will adopt. Bumping the
 * suffix (`meld:tool:v2`, etc.) is the breaking-schema escape hatch.
 *
 * NOT colocated with `useUiStore`'s `meld-ui-v1` key — that store
 * predates the convention. New stores adopt `meld:<scope>`; existing
 * stores stay where they are.
 */
export const TOOL_STORE_PERSIST_KEY = 'meld:tool';

/**
 * Default `lastUsedTool` — `'rectangle'` is the first slot in the
 * toolbar's tool order, so a fresh user who hits Escape before ever
 * picking a tool lands on a sensible default for the "revert to last"
 * affordance.
 */
const DEFAULT_LAST_USED: ShapeKind = 'rectangle';

const persistOptions: PersistOptions<
  ToolStoreState,
  Pick<ToolStoreState, 'tool' | 'lastUsedTool'>
> = {
  name: TOOL_STORE_PERSIST_KEY,
  version: 1,
  partialize: (state) => ({
    tool: state.tool,
    lastUsedTool: state.lastUsedTool,
  }),
  // Guard against a partial / typo-ed persisted value (someone hand-
  // edits localStorage, or a v2 schema replays into a v1 client).
  // Returns `undefined` when the persisted value fails the narrow,
  // which Zustand treats as "no persisted state, use the initial".
  merge: (persisted, current) => {
    if (typeof persisted !== 'object' || persisted === null) {
      return current;
    }
    const next: ToolStoreState = { ...current };
    const persistedTool = (persisted as { tool?: unknown }).tool;
    if (typeof persistedTool === 'string' && isToolKind(persistedTool)) {
      next.tool = persistedTool;
    }
    const persistedLast = (persisted as { lastUsedTool?: unknown }).lastUsedTool;
    if (
      typeof persistedLast === 'string' &&
      isToolKind(persistedLast) &&
      persistedLast !== 'select'
    ) {
      next.lastUsedTool = persistedLast;
    }
    return next;
  },
};

export const useToolStore = create<ToolStoreState>()(
  persist(
    (set, get) => ({
      tool: 'select',
      lastUsedTool: DEFAULT_LAST_USED,
      setTool: (next) => {
        // Track the most recent DRAWING tool so `revertToLast` has a
        // meaningful target. Picking `'select'` does NOT overwrite
        // the last drawing tool.
        if (next === 'select') {
          set({ tool: next });
          return;
        }
        set({ tool: next, lastUsedTool: next });
      },
      revertToLast: () => {
        // If the current tool is already a drawing tool, fall through
        // to select — pressing Escape with a draw tool active flips
        // to select. If the current tool is select, flip back to the
        // last drawing tool. This double-purpose matches Figma /
        // Excalidraw / tldraw — one key for "exit current tool" AND
        // "resume last tool".
        const { tool, lastUsedTool } = get();
        if (tool === 'select') {
          set({ tool: lastUsedTool });
        } else {
          set({ tool: 'select' });
        }
      },
    }),
    persistOptions,
  ),
);
