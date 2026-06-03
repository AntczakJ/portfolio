'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

interface StepShellProps {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
}

/**
 * Shared layout for a wizard step panel: a brass eyebrow + a focusable
 * Fraunces heading + an optional lead, then the step body.
 *
 * The heading carries the well-known id `wizard-step-heading` and
 * `tabIndex={-1}`. Focus is moved to it when the panel MOUNTS (D-A11Y-2):
 * because the wizard uses AnimatePresence `mode="wait"`, the incoming step
 * (and thus this heading) only mounts AFTER the outgoing step's exit
 * animation finishes — so a fixed `setTimeout` in the shell fired before the
 * heading existed and never landed focus. Moving focus from the heading's
 * OWN mount effect (via {@link useFocusStepHeadingOnMount}) is robust: it
 * runs exactly when the element is in the DOM, on every advance/back, with
 * no timing guess. The surrounding panel is the wizard's `aria-live` region,
 * so a screen reader also hears the new heading announced.
 *
 * Only ONE step is mounted at a time (AnimatePresence `mode="wait"`), so the
 * fixed id is unique in the document.
 */
export function StepShell({
  eyebrow,
  title,
  lead,
  children,
}: StepShellProps): ReactNode {
  const headingRef = useFocusStepHeadingOnMount<HTMLHeadingElement>();

  return (
    <div>
      <p className="text-brass-text flex items-center gap-3 text-[length:var(--text-caption)] tracking-[0.28em] uppercase">
        <span aria-hidden="true" className="h-px w-8 bg-[var(--color-edge-glow)]" />
        {eyebrow}
      </p>
      <h2
        ref={headingRef}
        id="wizard-step-heading"
        tabIndex={-1}
        className="font-display text-fg mt-4 text-[length:var(--text-h1)] leading-[1.05] [font-variation-settings:'opsz'_120,'wght'_440,'SOFT'_0] focus-visible:outline-none"
      >
        {title}
      </h2>
      {lead ? (
        <p className="text-fg-muted mt-4 max-w-xl text-balance text-[length:var(--text-body-lg)] leading-relaxed">
          {lead}
        </p>
      ) : null}

      <div className="mt-10">{children}</div>
    </div>
  );
}

/**
 * Move focus to the step heading when it mounts (D-A11Y-2). Returns a ref to
 * attach to the heading. The initial step mount is skipped only if the
 * heading already holds focus; otherwise every step transition lands focus on
 * the new heading. A `requestAnimationFrame` defers the call by one frame so
 * focus moves after the browser has painted the mounted node, which is robust
 * across the AnimatePresence enter transition and reduced-motion alike.
 */
export function useFocusStepHeadingOnMount<
  T extends HTMLElement,
>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Defer one frame so focus moves after the mounted node has painted —
    // robust across the AnimatePresence enter transition and reduced-motion.
    const raf = requestAnimationFrame(() => {
      node.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);
  return ref;
}
