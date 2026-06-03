'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { BookingStep } from '@/lib/schemas/booking';

import { STEP_DEFS } from './wizard-steps';

interface WizardProgressProps {
  current: BookingStep;
  /** Steps the user may jump back to (already completed). */
  canReach: (step: BookingStep) => boolean;
  onGoToStep: (step: BookingStep) => void;
  currentIndex: number;
}

/**
 * The wizard step indicator (ADR-003: a visible step indicator; back to
 * completed steps allowed).
 *
 * Rendered as an ordered list with the brass "lit edge" motif as the
 * progress rail: a thin brass line fills left-to-right with progress, and
 * the active step's marker glows. Completed steps are real buttons (jump
 * back); upcoming steps are inert. Keyboard-operable, with `aria-current`
 * on the active step and clear disabled state on the unreachable ones.
 *
 * On mobile the labels collapse to a compact "Step N of 5 — <label>" line
 * plus the dot rail, so it stays legible at 320 px.
 */
export function WizardProgress({
  current,
  canReach,
  onGoToStep,
  currentIndex,
}: WizardProgressProps): ReactNode {
  const total = STEP_DEFS.length;
  const progress = (currentIndex / (total - 1)) * 100;
  const activeDef = STEP_DEFS[currentIndex];

  return (
    <nav aria-label="Booking progress" className="w-full">
      {/* Compact mobile header. */}
      <p className="text-fg-subtle mb-4 flex items-baseline gap-2 text-sm sm:hidden">
        <span className="text-brass-text tabular-nums">
          Step {currentIndex + 1} of {total}
        </span>
        <span aria-hidden="true" className="text-fg-subtle">
          —
        </span>
        <span className="text-fg">{activeDef?.label}</span>
      </p>

      <ol className="relative flex items-center justify-between">
        {/* Rail (track + brass fill). */}
        <div
          aria-hidden="true"
          className="bg-border absolute top-[0.6875rem] right-3 left-3 h-px sm:top-[0.8125rem]"
        >
          <div
            className="h-px bg-[var(--color-edge-glow)] transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ width: `${String(progress)}%` }}
          />
        </div>

        {STEP_DEFS.map((def, index) => {
          const isCompleted = index < currentIndex;
          const isActive = def.step === current;
          const reachable = canReach(def.step);
          const isInteractive = reachable && index !== currentIndex;

          const marker = (
            <span
              className={cn(
                'relative z-[1] flex size-6 items-center justify-center rounded-full border text-xs tabular-nums transition-colors sm:size-7',
                isActive &&
                  'border-[var(--color-edge-glow)] bg-[var(--color-edge-glow)] text-[var(--color-on-brass)]',
                isCompleted &&
                  !isActive &&
                  'bg-brass border-brass text-on-brass',
                !isActive &&
                  !isCompleted &&
                  'border-border bg-bg text-fg-subtle',
              )}
            >
              {isCompleted && !isActive ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                index + 1
              )}
            </span>
          );

          return (
            <li
              key={def.step}
              className="flex flex-1 flex-col items-center first:items-start last:items-end"
            >
              {isInteractive ? (
                <button
                  type="button"
                  onClick={() => {
                    onGoToStep(def.step);
                  }}
                  aria-current={isActive ? 'step' : undefined}
                  className="group focus-visible:ring-ring flex flex-col items-center gap-2 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  {marker}
                  <span className="text-fg-muted group-hover:text-fg hidden text-xs tracking-wide transition-colors sm:block">
                    {def.label}
                  </span>
                </button>
              ) : (
                <span
                  aria-current={isActive ? 'step' : undefined}
                  className="flex flex-col items-center gap-2"
                >
                  {marker}
                  <span
                    className={cn(
                      'hidden text-xs tracking-wide sm:block',
                      isActive ? 'text-fg' : 'text-fg-subtle',
                    )}
                  >
                    {def.label}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
