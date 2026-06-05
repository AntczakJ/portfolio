'use client';

import type { ReactNode } from 'react';

/**
 * Step shell (Task 5.4) — the common heading + a11y scaffold for each wizard
 * step. The heading carries `tabIndex={-1}` + a stable id so the WIZARD (not the
 * shell) can move focus to it on a step CHANGE only — the shell no longer
 * focuses on mount, which prevented step 1's heading from stealing focus + a
 * field-style ring on the initial page load (A-09). The focus style is a
 * heading-appropriate accent underline ring, not a field outline box.
 */
interface StepShellProps {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}

export function StepShell({
  eyebrow,
  title,
  description,
  children,
}: StepShellProps): ReactNode {
  return (
    <div>
      <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
        {eyebrow}
      </p>
      <h1
        tabIndex={-1}
        id="wizard-step-heading"
        className="font-display text-foreground mt-2 inline-block rounded-sm text-[length:var(--text-2xl)] font-semibold tracking-[var(--tracking-tight)] outline-none focus-visible:[box-shadow:0_3px_0_-1px_var(--color-accent)]"
      >
        {title}
      </h1>
      {description ? (
        <p className="text-fg-muted mt-3 max-w-prose text-[length:var(--text-base)] leading-[var(--leading-normal)]">
          {description}
        </p>
      ) : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}
