import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BoardToolbar } from '../board-toolbar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToolStore } from '@/lib/stores/tool-store';

function renderToolbar(): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <BoardToolbar />
    </TooltipProvider>,
  );
}

/**
 * Tests for `<BoardToolbar />` Phase 4.3 D-03 active-state fix.
 *
 * Replaces the previous `bg-(--color-accent-soft) ring-2 ring-(...)`
 * combo with `bg-(--color-accent) text-(--color-accent-fg) shadow-sm`
 * â€” solid accent fill, on-accent foreground, no ring (tldraw / Linear
 * idiom). The inactive slot stays ghost-styled.
 */

function resetToolStore(): void {
  useToolStore.setState({ tool: 'select', lastUsedTool: 'rectangle' });
}

describe('<BoardToolbar /> Phase 4.3 D-03 active-state', () => {
  beforeEach(() => {
    resetToolStore();
  });

  afterEach(() => {
    cleanup();
    resetToolStore();
  });

  it('paints the active slot with bg-(--color-accent) + text-(--color-accent-fg)', () => {
    useToolStore.setState({ tool: 'rectangle' });
    renderToolbar();
    const button = screen.getByRole('button', { name: /Rectangle/ });
    expect(button.className).toContain('bg-(--color-accent)');
    expect(button.className).toContain('text-(--color-accent-fg)');
    expect(button.className).toContain('shadow-sm');
  });

  it('does NOT carry the legacy soft-bg + ring combo on the active slot', () => {
    useToolStore.setState({ tool: 'ellipse' });
    renderToolbar();
    const button = screen.getByRole('button', { name: /Ellipse/ });
    expect(button.className).not.toContain('bg-(--color-accent-soft)');
    expect(button.className).not.toContain('ring-2');
  });

  it('keeps the inactive slot ghost-styled (no accent fill)', () => {
    useToolStore.setState({ tool: 'rectangle' });
    renderToolbar();
    const ellipseBtn = screen.getByRole('button', { name: /Ellipse/ });
    expect(ellipseBtn.className).not.toContain('bg-(--color-accent)');
    expect(ellipseBtn.className).toContain('text-(--color-fg-muted)');
  });

  it('mirrors active state via aria-pressed', () => {
    useToolStore.setState({ tool: 'freehand' });
    renderToolbar();
    const freehand = screen.getByRole('button', { name: /Freehand/ });
    expect(freehand.getAttribute('aria-pressed')).toBe('true');
    const text = screen.getByRole('button', { name: /Text/ });
    expect(text.getAttribute('aria-pressed')).toBe('false');
  });
});
