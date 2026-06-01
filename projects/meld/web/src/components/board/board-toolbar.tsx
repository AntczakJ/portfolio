'use client';

import { useEffect } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Circle, MousePointer2, PenLine, Square, Type } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { ToolKind } from '@/lib/shapes/kinds';
import { useToolStore } from '@/lib/stores/tool-store';

/**
 * Bottom-center floating toolbar — Phase 3.2.
 *
 * Visual idiom: Linear-restraint pill anchored bottom-center, mirroring
 * tldraw's + Excalidraw's "thumb-reachable on a laptop, central focus
 * on a 1440px+ desktop" placement. shadcn `<Button variant="ghost">`
 * carries each slot; the active slot gets a subtle background + an
 * accent ring via `--color-accent`.
 *
 * Five slots in this order:
 *
 *   Select     (V)  — MousePointer2 — no-op state in Phase 3.2,
 *                     selection chrome lands in Phase 3.2b
 *   Rectangle  (R)  — Square
 *   Ellipse    (E)  — Circle
 *   Freehand   (P)  — PenLine
 *   Text       (T)  — Type
 *
 * `Escape` revokes the current tool back to `'select'`; pressing the
 * same key as the active tool toggles back to `'select'` as well, so
 * `R` enters rect-draw, `R` again exits it.
 *
 * Keyboard shortcuts are bound to the WINDOW (not a specific element)
 * so a user clicking on the canvas can still hit `R` without re-
 * focusing. The handler skips events whose target is inside an
 * `<input>` / `<textarea>` / `contenteditable` (the text-draft input
 * — typing `T` inside it should not switch tools).
 *
 * Accessibility:
 *
 *   - each tool button has an `aria-label` carrying the tool name +
 *     keyboard shortcut,
 *   - active state mirrored via `aria-pressed`,
 *   - tooltips reveal the shortcut on hover (sourced via shadcn
 *     Tooltip).
 */

interface ToolDescriptor {
  kind: ToolKind;
  label: string;
  shortcut: string;
  Icon: ComponentType<{ className?: string }>;
}

const TOOLS: readonly ToolDescriptor[] = [
  { kind: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2 },
  { kind: 'rectangle', label: 'Rectangle', shortcut: 'R', Icon: Square },
  { kind: 'ellipse', label: 'Ellipse', shortcut: 'E', Icon: Circle },
  { kind: 'freehand', label: 'Freehand', shortcut: 'P', Icon: PenLine },
  { kind: 'text', label: 'Text', shortcut: 'T', Icon: Type },
];

/**
 * Single source of truth for the keyboard map. Mapping `key.toLowerCase()`
 * means Shift+R also lands on `'rectangle'` — same as Figma /
 * Excalidraw / tldraw, where Shift modifies the draw, not the tool.
 */
const SHORTCUT_TO_TOOL: Readonly<Record<string, ToolKind>> = {
  v: 'select',
  r: 'rectangle',
  e: 'ellipse',
  p: 'freehand',
  t: 'text',
};

export function BoardToolbar(): ReactNode {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const revertToLast = useToolStore((s) => s.revertToLast);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      // Bail out if the user is typing in an input / textarea /
      // contenteditable — the text-draft input is the canonical
      // example. We check `event.target` not document.activeElement
      // because the event target is the more accurate "where did the
      // key go" signal when focus is shifting.
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Modifiers other than Shift go through to the browser — Ctrl /
      // Meta combinations are reserved for the OS and the dev-overlay
      // (Cmd+Shift+D).
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        revertToLast();
        return;
      }

      const lower = event.key.toLowerCase();
      const nextTool = SHORTCUT_TO_TOOL[lower];
      if (nextTool === undefined) return;
      event.preventDefault();
      // Same-key toggle: pressing `R` while rectangle is active flips
      // to select. Same UX as Excalidraw / tldraw.
      if (nextTool === tool && tool !== 'select') {
        setTool('select');
      } else {
        setTool(nextTool);
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [tool, setTool, revertToLast]);

  return (
    <div
      className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2"
      // `role="toolbar"` lets ATs announce the group; orientation
      // hint helps screen readers narrate left/right arrow nav.
      // We do not wire arrow-key cycling in Phase 3.2 — the single-
      // letter shortcuts are the canonical input.
      role="toolbar"
      aria-label="Drawing tools"
      aria-orientation="horizontal"
      data-testid="board-toolbar"
      data-active-tool={tool}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-(--color-border) bg-(--color-surface)/95 p-1 shadow-md backdrop-blur-sm">
        {TOOLS.map(({ kind, label, shortcut, Icon }) => {
          const active = tool === kind;
          return (
            <Tooltip key={kind}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${label} (${shortcut})`}
                  aria-pressed={active}
                  data-active={active ? 'true' : undefined}
                  data-testid={`toolbar-slot-${kind}`}
                  onClick={() => {
                    if (active && kind !== 'select') {
                      setTool('select');
                    } else {
                      setTool(kind);
                    }
                  }}
                  className={cn(
                    'rounded-full text-(--color-fg-muted) hover:text-(--color-fg)',
                    // Active slot — solid accent fill + on-accent
                    // foreground (Phase 4.3 D-03). tldraw / Linear
                    // idiom: the active tool is a full-chroma pill,
                    // not a soft-tone-on-soft-tone whisper. Drops
                    // the ring entirely — solid bg + shadow-sm
                    // carries the lift without ping-pong on hover.
                    // Focus ring switches to the on-accent foreground
                    // so it stays visible against the violet bg.
                    active &&
                      'bg-(--color-accent) text-(--color-accent-fg) shadow-sm hover:bg-(--color-accent) hover:text-(--color-accent-fg) focus-visible:ring-(--color-accent-fg)/40',
                  )}
                >
                  <Icon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                {label}
                <span className="ml-1.5 rounded-sm bg-background/20 px-1 font-mono text-[10px] uppercase">
                  {shortcut}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
