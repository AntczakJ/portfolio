import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { statusDescriptor } from '@/lib/fleet/status-descriptor';
import type { VehicleStatus } from '@/lib/fleet/types';

/**
 * StatusBadge — the status-not-colour-alone primitive (Task 5.1, the a11y gate).
 *
 * Renders a coloured dot + the icon + the text label. Colour is reinforcement;
 * the label and icon carry the meaning, so a colour-blind or monochrome viewer
 * reads the status fully. The accessible name is the label (the icon + dot are
 * aria-hidden so the status is announced once, cleanly).
 *
 * Two sizes: the compact `sm` for the dense fleet table, the default for the
 * detail panel header.
 */
export function StatusBadge({
  status,
  size = 'md',
  className,
}: {
  status: VehicleStatus;
  size?: 'sm' | 'md';
  className?: string;
}): ReactNode {
  const d = statusDescriptor(status);
  const Icon = d.icon;
  const sm = size === 'sm';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap font-medium',
        sm ? 'text-2xs' : 'text-xs',
        className,
      )}
    >
      <span
        className={cn('inline-block shrink-0 rounded-full', d.dotClass, sm ? 'size-1.5' : 'size-2')}
        aria-hidden="true"
      />
      <Icon className={cn('shrink-0', d.textClass, sm ? 'size-3' : 'size-3.5')} aria-hidden="true" />
      <span className={d.textClass}>{d.label}</span>
    </span>
  );
}
