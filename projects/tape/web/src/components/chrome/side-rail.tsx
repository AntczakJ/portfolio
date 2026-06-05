'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  Activity,
  PanelLeft,
  PanelLeftClose,
  Circle,
} from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useUiStore } from '@/lib/stores/ui-store';
import { cn } from '@/lib/cn';

const RAIL_EXPANDED_PX = 240;
const RAIL_COLLAPSED_PX = 56;
const RAIL_ID = 'tape-side-rail';

/**
 * Persistent left rail. Expanded 240 px / collapsed 56 px (icon-only).
 * State lives in the Zustand `useUiStore` so the choice survives
 * reloads via the `tape-ui-v1` persistence key.
 *
 * Responsive behaviour: at < 1024 px the rail auto-collapses to icon-only
 * on first mount unless the user has previously expanded it (the
 * persistent store wins over the breakpoint default — we set the value
 * only when no prior preference exists in the store).
 *
 * Hidden entirely below 768 px — the mobile slide-over (`MobileRail`) is
 * the substitute on small viewports.
 *
 * Motion: rail width animates with `layout`-style width transition at
 * 220 ms easeOutCubic. Respects `prefers-reduced-motion` via
 * `useReducedMotion()` — fallback is instant snap.
 */
export function SideRail(): ReactNode {
  const railCollapsed = useUiStore((s) => s.railCollapsed);
  const toggleRail = useUiStore((s) => s.toggleRail);
  const setRailCollapsed = useUiStore((s) => s.setRailCollapsed);
  const replayMode = useUiStore((s) => s.replayMode);
  const setReplayMode = useUiStore((s) => s.setReplayMode);
  const setReplayPositionMs = useUiStore((s) => s.setReplayPositionMs);
  const reduceMotion = useReducedMotion();

  // Tablet auto-collapse on first mount: between 768 px and 1023 px the
  // rail defaults to collapsed. The store still wins on user override —
  // we only force-collapse on the very first viewport observation if the
  // viewport is in the tablet band.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window.innerWidth;
    if (w >= 768 && w < 1024 && !railCollapsed) {
      setRailCollapsed(true);
    }
    // Intentionally run once per mount — we do not want the rail to
    // snap closed every time the user expands it on a tablet resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const width = railCollapsed ? RAIL_COLLAPSED_PX : RAIL_EXPANDED_PX;

  // First-commit guard. The rail width comes from a Zustand-persisted
  // store (`tape-ui-v1`) that rehydrates from localStorage AFTER the
  // first client render, and the tablet auto-collapse effect can flip it
  // too. If Motion animated those first-frame corrections, the chart to
  // the right would slide — Lighthouse scores that horizontal slide as
  // layout shift (CLS). So the very first commit snaps width instantly
  // (`duration: 0`); every user-driven toggle afterwards animates on the
  // normal 220 ms curve. The CSS `style.width` below also reserves the
  // SSR box so there is no `auto`→fixed jump before Motion's first
  // commit.
  const firstCommit = useRef(true);
  useEffect(() => {
    firstCommit.current = false;
  }, []);

  const transition =
    reduceMotion || firstCommit.current
      ? { duration: 0 }
      : { duration: 0.22, ease: [0.33, 1, 0.68, 1] as const };

  return (
    <motion.aside
      id={RAIL_ID}
      animate={{ width }}
      initial={false}
      transition={transition}
      style={{ width }}
      className="hidden shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface) md:flex"
      aria-label="Workspace navigation"
    >
      <div className="flex h-12 items-center justify-between px-3">
        <button
          type="button"
          onClick={toggleRail}
          aria-expanded={!railCollapsed}
          aria-controls={RAIL_ID}
          aria-label={railCollapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
          className="inline-flex size-8 items-center justify-center rounded-(--radius-sm) text-(--color-fg-muted) transition-colors hover:bg-(--color-surface-raised) hover:text-(--color-fg)"
        >
          {railCollapsed ? (
            <PanelLeft className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
        </button>
        {!railCollapsed && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--color-fg-subtle)">
            workspace
          </span>
        )}
      </div>
      <Separator />

      <nav
        className="flex flex-1 flex-col gap-1 p-2"
        aria-label="Primary workspace sections"
      >
        <RailEntry
          icon={<Activity className="size-4" aria-hidden="true" />}
          label="Live"
          active={replayMode === 'live'}
          collapsed={railCollapsed}
          onSelect={() => {
            setReplayMode('live');
            setReplayPositionMs(0);
          }}
        />
        <RailEntry
          icon={<Circle className="size-4" aria-hidden="true" />}
          label="Replay"
          active={replayMode === 'replay'}
          collapsed={railCollapsed}
          onSelect={() => {
            setReplayMode('replay');
          }}
        />
      </nav>
    </motion.aside>
  );
}

interface RailEntryProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed: boolean;
  /** Selecting the entry switches the data-source mode (Live ↔ Replay). */
  onSelect: () => void;
}

function RailEntry({
  icon,
  label,
  active = false,
  collapsed,
  onSelect,
}: RailEntryProps): ReactNode {
  const className = cn(
    'flex h-9 w-full items-center gap-3 rounded-(--radius-sm) px-2.5 text-left font-mono text-xs transition-colors',
    active &&
      'bg-(--color-surface-raised) text-(--color-fg) shadow-[inset_2px_0_0] shadow-(--color-accent)',
    !active && 'text-(--color-fg-muted) hover:bg-(--color-surface-raised) hover:text-(--color-fg)',
    collapsed && 'justify-center px-0',
  );

  const button = (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      aria-pressed={active}
      className={className}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );

  // Tooltip the label when collapsed so the icon-only rail stays legible.
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
