'use client';

import { CalendarPlus, Check, RotateCcw } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { ThemedImage } from '@/components/sections/themed-image';
import { formatCurrency } from '@/lib/format';
import { loadGsap } from '@/lib/gsap/register';
import { downloadReservationIcs } from '@/lib/ics';
import { getThemedRenderStill } from '@/mocks/configurator';
import type { ConfirmedReservation } from '@/lib/schemas/reservation-draft';

/**
 * Step 5 — Confirmation (Task 5.6).
 *
 * Renders the deterministic `ConfirmedReservation` the server action returned:
 * the reference code, the full summary (vehicle + carried config + range +
 * locations + extras + insurance + the price total), an "Add to calendar"
 * `.ics` download (hand-rolled, multi-day, client-side), an on-brand GSAP
 * flourish on the success check (reduced-motion safe), and HONEST demo-disclosure
 * copy ("no car was actually booked"). On mount focus lands on the heading.
 *
 * The persisted draft is cleared by the wizard shell when it sets the
 * confirmation; "Reserve another" resets the store.
 */
interface StepConfirmationProps {
  confirmation: ConfirmedReservation;
  onReserveAnother: () => void;
}

const INSURANCE_LABEL: Record<string, string> = {
  basic: 'Basic cover',
  plus: 'Plus cover',
  premium: 'Premium cover',
};

export function StepConfirmation({
  confirmation,
  onReserveAnother,
}: StepConfirmationProps): ReactNode {
  const badgeRef = useRef<HTMLDivElement>(null);

  // Heading focus is centralised in the wizard (fires on the step CHANGE into
  // confirmation, A-09) — the shared `wizard-step-heading` id below is the
  // target. This component does not focus on mount.

  // On-brand success flourish: a quick scale/settle on the check badge + a
  // ring sweep. GSAP, transform/opacity only, reduced-motion → no animation.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void loadGsap().then(({ gsap }) => {
      if (cancelled || !badgeRef.current) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const tl = gsap.timeline();
        tl.fromTo(
          badgeRef.current,
          { scale: 0.6, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.7)' },
        );
        return () => tl.kill();
      });
      cleanup = () => { mm.revert(); };
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const { quote, currency } = confirmation;
  const config =
    confirmation.colorName && confirmation.wheelName
      ? `${confirmation.colorName} / ${confirmation.wheelName}`
      : null;

  // A-17: close the configurator spine at confirmation — show a small studio
  // render of the CHOSEN colour × wheel (the carried config), theme-aware,
  // reusing the existing render-matrix stills so "one car, brought closer"
  // resolves visually, not only in text. Only the configurable hero carries a
  // `config`; non-configurable vehicles simply omit the render.
  const configStillLight = confirmation.config
    ? getThemedRenderStill(
        confirmation.config.colorId,
        confirmation.config.wheelId,
        'light',
      )
    : undefined;
  const configStillDark = confirmation.config
    ? getThemedRenderStill(
        confirmation.config.colorId,
        confirmation.config.wheelId,
        'dark',
      )
    : undefined;

  return (
    <div className="mx-auto max-w-2xl text-center">
      <div
        ref={badgeRef}
        aria-hidden="true"
        className="bg-accent text-accent-contrast mx-auto inline-flex size-16 items-center justify-center rounded-full shadow-[var(--shadow-studio)]"
      >
        <Check className="size-8" />
      </div>

      <p className="text-accent-ink mt-6 text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
        Reservation confirmed
      </p>
      <h1
        tabIndex={-1}
        id="wizard-step-heading"
        // N-3: scroll-margin so the focus-scroll (on the step change into
        // confirmation) keeps the heading + the badge + the config-render card
        // below it CLEAR of the fixed sticky header — never tucked behind it.
        className="font-display text-foreground mt-2 inline-block scroll-mt-28 rounded-sm text-[length:var(--text-3xl)] font-semibold tracking-[var(--tracking-tight)] outline-none focus-visible:[box-shadow:0_3px_0_-1px_var(--color-accent)] sm:scroll-mt-32"
      >
        You are all set
      </h1>
      <p className="text-fg-muted mt-3">
        Your reference is{' '}
        <span className="text-foreground font-semibold tabular-nums">
          {confirmation.reference}
        </span>
        .
      </p>

      {/* The chosen configuration, brought closer (A-17) — a small studio still
          of the carried colour × wheel, theme-aware. Only present for the
          configurable hero. */}
      {configStillLight ? (
        <div className="border-border bg-surface-2 relative mx-auto mt-8 aspect-[16/9] w-full max-w-md overflow-hidden rounded-[var(--radius-xl)] border">
          <ThemedImage
            lightSrc={configStillLight}
            {...(configStillDark ? { darkSrc: configStillDark } : {})}
            alt={`${confirmation.vehicleName}${config ? ` — ${config}` : ''}, your configuration`}
            sizes="(max-width: 768px) 100vw, 28rem"
            fit="object-cover"
            className="object-center"
          />
        </div>
      ) : null}

      {/* Summary card. */}
      <div className="border-border bg-surface mt-8 rounded-[var(--radius-xl)] border p-6 text-left shadow-[var(--shadow-card)]">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
              Vehicle
            </dt>
            <dd className="text-foreground mt-0.5 text-sm font-medium">
              {confirmation.vehicleName}
            </dd>
            {config ? (
              <dd className="text-fg-muted text-[length:var(--text-2xs)]">
                {config}
              </dd>
            ) : null}
          </div>
          <div>
            <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
              Dates
            </dt>
            <dd className="text-foreground mt-0.5 text-sm">
              {confirmation.range.fromISODate} → {confirmation.range.toISODate}
              <span className="text-fg-muted">
                {' '}
                ({confirmation.rentalDays}{' '}
                {confirmation.rentalDays === 1 ? 'day' : 'days'})
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
              Pick-up
            </dt>
            <dd className="text-foreground mt-0.5 text-sm">
              {confirmation.pickupName}
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
              Return
            </dt>
            <dd className="text-foreground mt-0.5 text-sm">
              {confirmation.returnName}
            </dd>
          </div>
          {confirmation.extras.length > 0 ? (
            <div className="sm:col-span-2">
              <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
                Extras
              </dt>
              <dd className="text-foreground mt-0.5 text-sm">
                {confirmation.extras.join(', ')}
              </dd>
            </div>
          ) : null}
          {confirmation.insuranceTier ? (
            <div>
              <dt className="text-fg-subtle text-[length:var(--text-2xs)] tracking-[var(--tracking-wide)] uppercase">
                Insurance
              </dt>
              <dd className="text-foreground mt-0.5 text-sm">
                {INSURANCE_LABEL[confirmation.insuranceTier] ??
                  confirmation.insuranceTier}
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-5 flex items-baseline justify-between border-t border-[var(--color-border)] pt-5">
          <span className="text-foreground text-sm font-medium">
            Estimated total{' '}
            <span className="text-fg-subtle font-normal">
              (due on collection · demo)
            </span>
          </span>
          <span className="text-foreground text-[length:var(--text-2xl)] font-semibold tabular-nums">
            {formatCurrency(quote.total, currency)}
          </span>
        </div>
      </div>

      {/* Actions. */}
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => { downloadReservationIcs(confirmation); }}
          className="border-border-strong bg-surface text-foreground hover:bg-surface-2 focus-visible:ring-ring inline-flex h-12 items-center gap-2 rounded-md border px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <CalendarPlus className="size-4" aria-hidden="true" />
          Add to calendar
        </button>
        <button
          type="button"
          onClick={onReserveAnother}
          className="text-fg-muted hover:text-foreground focus-visible:ring-ring inline-flex h-12 items-center gap-2 rounded-md px-4 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reserve another
        </button>
      </div>

      {/* Honest demo disclosure. */}
      <p className="text-fg-subtle mx-auto mt-8 max-w-md text-[length:var(--text-xs)] leading-[var(--leading-normal)]">
        This is a demo reservation — no car was actually booked, no card was
        charged, and no details were stored. The calendar file is generated in
        your browser.
      </p>
    </div>
  );
}
