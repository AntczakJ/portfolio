'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
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
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.33, 1, 0.68, 1] as const };

  return (
    <motion.aside
      id={RAIL_ID}
      animate={{ width }}
      initial={false}
      transition={transition}
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
          active
          collapsed={railCollapsed}
        />
        <RailEntry
          icon={<Circle className="size-4" aria-hidden="true" />}
          label="Replay"
          disabled
          collapsed={railCollapsed}
        />
      </nav>
    </motion.aside>
  );
}

interface RailEntryProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  collapsed: boolean;
}

function RailEntry({
  icon,
  label,
  active = false,
  disabled = false,
  collapsed,
}: RailEntryProps): ReactNode {
  const className = cn(
    'flex h-9 items-center gap-3 rounded-(--radius-sm) px-2.5 font-mono text-xs transition-colors',
    active &&
      'bg-(--color-surface-raised) text-(--color-fg) shadow-[inset_2px_0_0] shadow-(--color-accent)',
    !active && !disabled && 'text-(--color-fg-muted) hover:bg-(--color-surface-raised) hover:text-(--color-fg)',
    disabled && 'cursor-not-allowed text-(--color-fg-subtle) opacity-60',
    collapsed && 'justify-center px-0',
  );

  const content = (
    <>
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </>
  );

  // Always tooltip when collapsed; tooltip the disabled "Replay" v2 hint
  // when expanded so users know why it is greyed out.
  const tooltipText = disabled
    ? 'Replay mode arrives in v2.'
    : label;

  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="link"
            aria-disabled="true"
            tabIndex={-1}
            className={className}
            data-state="disabled"
          >
            {content}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right">{tooltipText}</TooltipContent>
      </Tooltip>
    );
  }

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <a href="#main" className={className} aria-current={active ? 'page' : undefined}>
            {content}
          </a>
        </TooltipTrigger>
        <TooltipContent side="right">{tooltipText}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <a href="#main" className={className} aria-current={active ? 'page' : undefined}>
      {content}
    </a>
  );
}
