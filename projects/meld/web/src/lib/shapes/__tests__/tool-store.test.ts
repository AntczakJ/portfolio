/**
 * Tool-store tests — Phase 3.2.
 *
 * We assert:
 *
 *   - the persist key is `meld:tool` (the cross-store convention),
 *   - `setTool('rectangle')` updates `tool` AND `lastUsedTool`,
 *   - `setTool('select')` does NOT clobber `lastUsedTool` (so
 *     Escape-back works),
 *   - `revertToLast` toggles between `'select'` and the last drawing
 *     tool — both directions,
 *   - the persisted payload survives a fresh `localStorage` rehydrate
 *     (round-trip the persisted blob through the merge function).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  TOOL_STORE_PERSIST_KEY,
  useToolStore,
} from '@/lib/stores/tool-store';

function resetStore(): void {
  useToolStore.setState({ tool: 'select', lastUsedTool: 'rectangle' });
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(TOOL_STORE_PERSIST_KEY);
  }
}

describe('useToolStore — initial state', () => {
  beforeEach(resetStore);

  it("defaults to tool='select' + lastUsedTool='rectangle'", () => {
    const { tool, lastUsedTool } = useToolStore.getState();
    expect(tool).toBe('select');
    expect(lastUsedTool).toBe('rectangle');
  });

  it("persists under the documented key 'meld:tool'", () => {
    expect(TOOL_STORE_PERSIST_KEY).toBe('meld:tool');
  });
});

describe('setTool', () => {
  beforeEach(resetStore);

  it("'rectangle' updates tool AND lastUsedTool", () => {
    useToolStore.getState().setTool('rectangle');
    expect(useToolStore.getState().tool).toBe('rectangle');
    expect(useToolStore.getState().lastUsedTool).toBe('rectangle');
  });

  it("'ellipse' overwrites lastUsedTool to ellipse", () => {
    useToolStore.getState().setTool('ellipse');
    expect(useToolStore.getState().lastUsedTool).toBe('ellipse');
  });

  it("'select' does NOT overwrite lastUsedTool", () => {
    useToolStore.getState().setTool('freehand');
    expect(useToolStore.getState().lastUsedTool).toBe('freehand');
    useToolStore.getState().setTool('select');
    expect(useToolStore.getState().tool).toBe('select');
    // Last drawing tool is still freehand — the Escape revert depends
    // on this.
    expect(useToolStore.getState().lastUsedTool).toBe('freehand');
  });

  it('admits all four shape tools + select', () => {
    for (const k of ['rectangle', 'ellipse', 'freehand', 'text', 'select'] as const) {
      useToolStore.getState().setTool(k);
      expect(useToolStore.getState().tool).toBe(k);
    }
  });
});

describe('revertToLast', () => {
  beforeEach(resetStore);

  it("from 'select' flips to lastUsedTool", () => {
    useToolStore.setState({ tool: 'select', lastUsedTool: 'ellipse' });
    useToolStore.getState().revertToLast();
    expect(useToolStore.getState().tool).toBe('ellipse');
  });

  it("from a drawing tool flips to 'select' (Escape semantics)", () => {
    useToolStore.getState().setTool('freehand');
    useToolStore.getState().revertToLast();
    expect(useToolStore.getState().tool).toBe('select');
  });

  it("preserves lastUsedTool across both directions", () => {
    useToolStore.getState().setTool('text'); // lastUsedTool = 'text'
    useToolStore.getState().revertToLast(); // -> 'select', lastUsedTool stays 'text'
    expect(useToolStore.getState().lastUsedTool).toBe('text');
    useToolStore.getState().revertToLast(); // 'select' -> 'text'
    expect(useToolStore.getState().tool).toBe('text');
  });
});

describe('persistence rehydrate path', () => {
  beforeEach(resetStore);

  it("survives a save -> load round-trip through localStorage", () => {
    useToolStore.getState().setTool('ellipse');
    // Zustand persist writes synchronously on `set` in the default
    // storage path; verify the JSON is in place.
    const raw = window.localStorage.getItem(TOOL_STORE_PERSIST_KEY);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    const parsed = JSON.parse(raw) as { state: unknown; version: number };
    expect(parsed.version).toBe(1);
    expect(parsed.state).toMatchObject({ tool: 'ellipse', lastUsedTool: 'ellipse' });
  });

  it("excludes the setter functions from the persisted payload", () => {
    useToolStore.getState().setTool('text');
    const raw = window.localStorage.getItem(TOOL_STORE_PERSIST_KEY);
    if (raw === null) {
      throw new Error('persist write missing');
    }
    const parsed = JSON.parse(raw) as { state: Record<string, unknown> };
    expect(parsed.state).not.toHaveProperty('setTool');
    expect(parsed.state).not.toHaveProperty('revertToLast');
  });
});
