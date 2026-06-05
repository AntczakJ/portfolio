'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { WizardStep } from '@/lib/schemas/reservation-draft';
import {
  WIZARD_INDICATOR_STEPS,
  stepIndex,
} from '@/lib/store/wizard-machine';

/**
 * The wizard step indicator (Task 5.4).
 *
 * Four interactive steps (the terminal confirmation is not shown — it is a
 * destination, not a stage). Each marker is a real `<button>`: reachable steps
 * are clickable (jump back / forward to a completed stage), unreachable ones are
 * disabled. The current step is marked `aria-current="step"`. The whole thing is
 * an ordered list for assistive tech; the connecting line uses the track-line
 * motif (lit up to the current step).
 *
 * Mobile: a compact "Step N of 4 — Label" line above the markers (the labels
 * are hidden on the smallest widths to keep the row legible at 320px).
 */

const STEP_LABELS: Record<WizardStep, string> = {
  vehicle: 'Vehicle',
  'dates-locations': 'Dates & places',
  extras: 'Extras',
  driver: 'Your details',
  confirmation: 'Confirmation',
};

interface StepIndicatorProps {
  current: WizardStep;
  canReach: (step: WizardStep) => boolean;
  onGoToStep: (step: WizardStep) => void;
}

export function StepIndicator({
  current,
  canReach,
  onGoToStep,
}: StepIndicatorProps): ReactNode {
  const currentIndex = stepIndex(current);
  const total = WIZARD_INDICATOR_STEPS.length;

  return (
    <nav aria-label="Reservation steps">
      {/* Compact mobile line. */}
      <p className="text-fg-muted mb-4 text-sm sm:hidden">
        Step {currentIndex + 1} of {total}
        <span className="text-foreground font-medium">
          {' · '}
          {STEP_LABELS[current]}
        </span>
      </p>

      <ol className="flex items-center justify-between">
        {WIZARD_INDICATOR_STEPS.map((step, i) => {
          const index = stepIndex(step);
          const isDone = index < currentIndex;
          const isCurrent = step === current;
          const reachable = canReach(step);
          const isLast = i === WIZARD_INDICATOR_STEPS.length - 1;

          return (
            <li
              key={step}
              className={cn('flex items-center', !isLast && 'flex-1')}
            >
              <button
                type="button"
                onClick={() => { onGoToStep(step); }}
                disabled={!reachable}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`Step ${String(i + 1)}: ${STEP_LABELS[step]}${isDone ? ' (completed)' : ''}`}
                className="group flex shrink-0 flex-col items-center gap-2 outline-none disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    'inline-flex size-7 items-center justify-center rounded-full border text-sm font-medium tabular-nums transition-colors',
                    'group-focus-visible:outline-[3px] group-focus-visible:outline-offset-2 group-focus-visible:outline-[var(--color-ring)]',
                    isCurrent &&
                      'bg-accent text-accent-contrast border-accent',
                    isDone &&
                      !isCurrent &&
                      'bg-accent-soft text-accent-ink border-accent/40',
                    !isCurrent &&
                      !isDone &&
                      reachable &&
                      'border-border-strong text-fg-muted group-hover:border-accent',
                    !isCurrent &&
                      !isDone &&
                      !reachable &&
                      'border-border text-fg-subtle opacity-60',
                  )}
                >
                  {isDone ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    'hidden text-[length:var(--text-xs)] sm:block',
                    isCurrent
                      ? 'text-foreground font-medium'
                      : 'text-fg-subtle',
                  )}
                >
                  {STEP_LABELS[step]}
                </span>
              </button>

              {/* Connector (track-line motif), lit up to the current step. */}
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className="mx-2 -mt-6 h-px flex-1 sm:mx-3"
                  style={{
                    backgroundColor: isDone
                      ? 'var(--color-accent)'
                      : 'var(--color-border)',
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
