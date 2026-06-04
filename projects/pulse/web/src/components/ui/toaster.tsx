'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  useToastStore,
  type Toast,
  type ToastTone,
} from '@/lib/store/toast-store';

/**
 * The toaster — a fixed, bottom-right stack of transient notifications.
 *
 * Driven by the Motion `AnimatePresence` enter/exit (the project's single
 * animation library, § 15 / ADR-001), gated behind `useReducedMotion()` so a
 * reduced-motion user gets an instant appear/disappear instead of the slide.
 *
 * The wow-moment alert toast ("Alert sent: <monitor> is down") is pushed from
 * the board's `onAlertFired` SSE sink; the demo-button recovery toast is pushed
 * from the demo flow. Each toast carries a tone (down / up / info) that maps to
 * the sovereign status tokens — never color-alone, the tone also picks an icon
 * and the title carries the words.
 *
 * Accessibility: the region is `aria-live="assertive"` (an alert firing is a
 * timely, important event) with `role="region"`; the dismiss button is a real
 * keyboard-reachable button.
 */
export function Toaster(): ReactNode {
  const toasts = useToastStore((s) => s.toasts);
  const reduceMotion = useReducedMotion();

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end sm:p-6"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            reduceMotion={reduceMotion ?? false}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

const TONE_STYLES: Record<
  ToastTone,
  { border: string; icon: ReactNode; iconColor: string }
> = {
  down: {
    border: 'border-status-down/45',
    icon: <AlertTriangleIcon />,
    iconColor: 'text-status-down-text',
  },
  up: {
    border: 'border-status-up/45',
    icon: <CheckCircle2Icon />,
    iconColor: 'text-status-up-text',
  },
  info: {
    border: 'border-border-strong',
    icon: <InfoIcon />,
    iconColor: 'text-brand',
  },
};

function ToastCard({
  toast,
  reduceMotion,
}: {
  toast: Toast;
  reduceMotion: boolean;
}): ReactNode {
  const dismiss = useToastStore((s) => s.dismissToast);
  const tone = TONE_STYLES[toast.tone];

  useEffect(() => {
    if (toast.duration <= 0) return undefined;
    const timer = setTimeout(() => {
      dismiss(toast.id);
    }, toast.duration);
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, toast.duration, dismiss]);

  return (
    <motion.div
      layout={!reduceMotion}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24, scale: 0.98 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg shadow-black/5 dark:shadow-black/40',
        tone.border,
      )}
    >
      <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', tone.iconColor)}>
        {tone.icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">{toast.title}</p>
        {toast.description ? (
          <p className="text-xs text-fg-muted">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => {
          dismiss(toast.id);
        }}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-fg-subtle transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon className="size-3.5" />
      </button>
    </motion.div>
  );
}
