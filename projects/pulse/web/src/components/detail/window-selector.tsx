'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import type { MonitorWindow } from 'pulse-server';

interface WindowSelectorProps {
  value: MonitorWindow;
  onChange: (next: MonitorWindow) => void;
  className?: string;
}

const WINDOWS: readonly { value: MonitorWindow; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

/**
 * The 24h / 7d / 30d window selector — a segmented control (the Linear/Vercel
 * dashboard idiom) that drives the uptime, series, and history queries off one
 * toggle. Keyboard-reachable (it is real buttons), with a visible focus ring
 * and `aria-pressed` on the active segment.
 */
export function WindowSelector({
  value,
  onChange,
  className,
}: WindowSelectorProps): ReactNode {
  return (
    <div
      role="group"
      aria-label="Time window"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5',
        className,
      )}
    >
      {WINDOWS.map((w) => {
        const active = w.value === value;
        return (
          <button
            key={w.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(w.value);
            }}
            className={cn(
              'rounded-[5px] px-3 py-1 font-mono text-xs font-medium tabular-nums transition-colors',
              active
                ? 'bg-surface-raised text-foreground shadow-sm'
                : 'text-fg-muted hover:text-foreground',
            )}
          >
            {w.label}
          </button>
        );
      })}
    </div>
  );
}
