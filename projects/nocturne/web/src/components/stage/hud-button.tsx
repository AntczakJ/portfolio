'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * A single HUD control — a real `<button>` with brand-styled visible focus,
 * AA-contrast ink over the scrim, and an active (`aria-pressed`) state. Used for
 * the preset / source / toggle controls so they share one keyboard-operable,
 * accessible primitive. CSS-only transitions (ADR-001).
 */
export interface HudButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  /** Render as a compact icon-only control (still needs an aria-label). */
  iconOnly?: boolean;
}

export function HudButton({
  active = false,
  iconOnly = false,
  className,
  children,
  ...rest
}: HudButtonProps): ReactNode {
  return (
    <button
      type="button"
      data-active={active || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] text-xs font-medium transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2',
        // Over-stage ink: the theme-INVARIANT --hud-ink-muted (NOT the chrome
        // --color-fg-muted), so the control stays legible on the always-dark
        // scrim even in light chrome (ADR-004 §4).
        'text-[var(--hud-ink-muted)] hover:text-[var(--hud-ink)] data-[active]:text-[var(--hud-ink)]',
        'data-[active]:bg-[var(--stage-scrim-strong)]',
        iconOnly ? 'size-9' : 'px-2.5 py-1.5',
        className,
      )}
      style={{ outlineColor: 'var(--color-accent)' }}
      {...rest}
    >
      {children}
    </button>
  );
}
