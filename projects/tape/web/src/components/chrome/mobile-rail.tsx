'use client';

import type { ReactNode } from 'react';
import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Activity, Circle, PanelLeft, PanelLeftClose } from 'lucide-react';

import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/cn';

/**
 * Mobile rail substitute. Shown only below 768 px (md breakpoint).
 *
 * A top-bar icon button toggles a slide-over panel that mirrors the
 * SideRail entries. We deliberately do not install shadcn `sheet` for a
 * single breakpoint — this hand-rolled panel is cheaper and easier to
 * keep in step with the desktop rail's typography.
 *
 * Body scroll lock on open and Escape-to-close are standard slide-over
 * affordances; both respect reduced motion.
 */
export function MobileRail(): ReactNode {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.33, 1, 0.68, 1] as const };

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Open navigation"
        className="inline-flex size-8 items-center justify-center rounded-(--radius-sm) text-(--color-fg-muted) transition-colors hover:bg-(--color-surface) hover:text-(--color-fg)"
      >
        <PanelLeft className="size-4" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
              onClick={() => {
                setOpen(false);
              }}
              className="fixed inset-0 z-40 bg-(--color-bg)/70 backdrop-blur-sm"
              aria-hidden="true"
            />
            <motion.aside
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-label="Workspace navigation"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={transition}
              className="fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] flex-col border-r border-(--color-border) bg-(--color-surface)"
            >
              <div className="flex h-12 items-center justify-between px-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-(--color-fg-subtle)">
                  workspace
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                  }}
                  aria-label="Close navigation"
                  className="inline-flex size-8 items-center justify-center rounded-(--radius-sm) text-(--color-fg-muted) transition-colors hover:bg-(--color-surface-raised) hover:text-(--color-fg)"
                >
                  <PanelLeftClose className="size-4" aria-hidden="true" />
                </button>
              </div>
              <Separator />
              <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Primary workspace sections">
                <MobileEntry
                  icon={<Activity className="size-4" aria-hidden="true" />}
                  label="Live"
                  active
                />
                <MobileEntry
                  icon={<Circle className="size-4" aria-hidden="true" />}
                  label="Replay"
                  disabled
                />
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

interface MobileEntryProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}

function MobileEntry({
  icon,
  label,
  active = false,
  disabled = false,
}: MobileEntryProps): ReactNode {
  const className = cn(
    'flex h-9 items-center gap-3 rounded-(--radius-sm) px-2.5 font-mono text-xs transition-colors',
    active &&
      'bg-(--color-surface-raised) text-(--color-fg) shadow-[inset_2px_0_0] shadow-(--color-accent)',
    !active && !disabled && 'text-(--color-fg-muted) hover:bg-(--color-surface-raised) hover:text-(--color-fg)',
    disabled && 'cursor-not-allowed text-(--color-fg-subtle) opacity-60',
  );

  if (disabled) {
    return (
      <span
        role="link"
        aria-disabled="true"
        tabIndex={-1}
        className={className}
        title="Replay mode arrives in v2."
      >
        <span className="shrink-0">{icon}</span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <a href="#main" className={className} aria-current={active ? 'page' : undefined}>
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </a>
  );
}
