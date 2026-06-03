'use client';

import { ArrowRight, Clock, Scissors, User, CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  formatDateLong,
  formatDuration,
  formatPrice,
  formatTimeRange,
} from '@/lib/format';
import { getBarberById, getServiceById } from '@/mocks';
import type { BookingDraft } from '@/lib/schemas/booking';

interface WizardSummaryProps {
  draft: BookingDraft;
  /** Compact variant for the sticky mobile bottom bar. */
  variant?: 'rail' | 'bar';
  /**
   * The primary advance action for the mobile sticky bar (D-08) — so the
   * Continue / Confirm CTA is never below the fold on mobile. Only the `bar`
   * variant renders it.
   */
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
}

/**
 * The running-selection summary (PLAN.md / ADR-003): service, barber,
 * date/time, and the price. Two presentations from one source:
 *
 *  - `rail` — the desktop side rail (a quiet card listing each chosen
 *    field as it is filled, with the price footing it).
 *  - `bar`  — the mobile sticky bottom bar (a single condensed line:
 *    service + price, expanding context as the draft fills).
 *
 * It reads the draft directly and resolves the catalog rows; nothing here
 * is interactive (the steps own selection), so it is a pure presentation
 * of state.
 */
export function WizardSummary({
  draft,
  variant = 'rail',
  primaryAction,
}: WizardSummaryProps): ReactNode {
  const service = draft.serviceId ? getServiceById(draft.serviceId) : undefined;
  const barber = draft.barberId ? getBarberById(draft.barberId) : undefined;
  const barberLabel = draft.anyBarber
    ? 'Any available barber'
    : barber?.name;

  if (variant === 'bar') {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-fg truncate text-sm font-medium">
            {service ? service.name : 'Choose a service'}
          </p>
          <p className="text-fg-subtle truncate text-xs">
            {service ? (
              <span className="text-brass-text mr-1.5 tabular-nums">
                {formatPrice(service.priceMinor, service.currency)}
              </span>
            ) : null}
            {barberLabel ?? 'Your booking so far'}
            {draft.date ? ` · ${formatDateLong(draft.date).split(' ').slice(0, 2).join(' ')}` : ''}
            {service && draft.startMin !== undefined
              ? ` · ${formatTimeRange(draft.startMin, service.durationMin).split(' ')[0] ?? ''}`
              : ''}
          </p>
        </div>
        {/* D-08: the primary advance CTA lives IN the bar on mobile so it is
            never below the fold past the Notes field. */}
        {primaryAction ? (
          <button
            type="button"
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
          >
            {primaryAction.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="border-border bg-surface/40 rounded-lg border p-6">
      <p className="text-brass-text flex items-center gap-3 text-[length:var(--text-caption)] tracking-[0.28em] uppercase">
        <span aria-hidden="true" className="h-px w-6 bg-[var(--color-edge-glow)]" />
        Your booking
      </p>

      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-5">
        <SummaryRow
          icon={<Scissors className="size-4" aria-hidden="true" />}
          label="Service"
          value={
            service ? (
              <span className="flex flex-col items-end">
                <span>{service.name}</span>
                <span className="text-fg-subtle text-xs">
                  {formatDuration(service.durationMin)}
                </span>
              </span>
            ) : null
          }
        />
        <SummaryRow
          icon={<User className="size-4" aria-hidden="true" />}
          label="Barber"
          value={barberLabel ?? null}
        />
        <SummaryRow
          icon={<CalendarDays className="size-4" aria-hidden="true" />}
          label="Date"
          value={draft.date ? formatDateLong(draft.date) : null}
        />
        <SummaryRow
          icon={<Clock className="size-4" aria-hidden="true" />}
          label="Time"
          value={
            service && draft.startMin !== undefined
              ? formatTimeRange(draft.startMin, service.durationMin)
              : null
          }
        />
      </dl>

      {service ? (
        <div className="border-border mt-6 flex items-baseline justify-between border-t pt-5">
          <span className="text-fg-muted text-sm">Total</span>
          <span className="font-display text-fg text-[length:var(--text-h3)] tabular-nums [font-variation-settings:'opsz'_40,'wght'_500]">
            {formatPrice(service.priceMinor, service.currency)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}): ReactNode {
  const filled = value !== null && value !== undefined;
  // `<dt>`/`<dd>` are DIRECT children of the `<dl>` (no wrapping `<div>`) so
  // the definition-list structure is valid (Lighthouse `dlitem` audit). The
  // icon lives inside the `<dt>`; the layout is a CSS grid on the `<dl>`.
  return (
    <>
      <dt className="text-fg-subtle col-start-1 flex items-center gap-2.5 self-center text-xs tracking-wide uppercase">
        <span
          aria-hidden="true"
          className={filled ? 'text-brass-text' : 'text-fg-subtle'}
        >
          {icon}
        </span>
        {label}
      </dt>
      <dd className="text-fg col-start-2 self-center text-right text-sm">
        {filled ? value : <span className="text-fg-subtle">—</span>}
      </dd>
    </>
  );
}
