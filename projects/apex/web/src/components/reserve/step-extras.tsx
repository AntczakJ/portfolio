'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { formatCurrency } from '@/lib/format';
import { useExtras } from '@/lib/queries/reservation-queries';
import type { InsuranceTier } from '@/lib/schemas/common';
import { isInsuranceExtra, type AddOnExtra, type InsuranceExtra } from '@/lib/schemas/extra';

import { StepShell } from './step-shell';

/**
 * Step 3 — Extras + insurance tier (Task 5.5).
 *
 * Two distinct controls per ADR-003 I-A: a MULTI-SELECT of non-insurance
 * add-ons (checkboxes — zero-or-more) and a SINGLE-CHOICE insurance tier ladder
 * (radio group — exactly-one-of, or none). Both update the live price in the
 * summary rail immediately (the rail recomputes `priceQuote` from the store).
 * The catalog is fetched through the TanStack Query mock layer.
 */

const TIER_ORDER: Record<InsuranceTier, number> = {
  basic: 0,
  plus: 1,
  premium: 2,
};

/** The quietly-recommended tier (a UI-level steer, not a data field). */
const RECOMMENDED_TIER: InsuranceTier = 'plus';

interface StepExtrasProps {
  currency: string;
  selectedExtras: readonly string[];
  insuranceTier: InsuranceTier | undefined;
  onToggleExtra: (id: string) => void;
  onSelectInsurance: (tier: InsuranceTier | undefined) => void;
}

function priceLabel(
  extra: AddOnExtra | InsuranceExtra,
  currency: string,
): string {
  const amount = formatCurrency(extra.priceMinor, currency);
  return extra.pricing === 'per-day' ? `${amount} / day` : amount;
}

/**
 * One insurance-tier card (A-16). All tiers — including "No extra cover" — use
 * ONE selection idiom: an accent border + wash + a top-right accent check when
 * chosen (the same affordance as the add-on cards), so the selected state is
 * unmistakable everywhere. The recommended tier carries a quiet "Recommended"
 * pill so the ladder's escalation reads.
 */
function InsuranceCard({
  title,
  description,
  metaText,
  priceText,
  recommended = false,
  checked,
  onSelect,
}: {
  title: string;
  description: string;
  metaText?: string;
  priceText: string;
  recommended?: boolean;
  checked: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <label
      className={cn(
        'group relative flex cursor-pointer flex-col rounded-[var(--radius-lg)] border p-4 transition-colors',
        checked
          ? 'border-accent bg-accent-soft/40'
          : 'border-border bg-surface hover:border-border-strong',
      )}
    >
      <input
        type="radio"
        name="apex-insurance"
        checked={checked}
        onChange={onSelect}
        className="peer sr-only"
      />
      {/* The unified selected indicator (top-right accent check). The empty
          ring keeps the slot reserved so cards do not shift on select. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-3 right-3 inline-flex size-5 items-center justify-center rounded-full border transition-colors',
          'peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-[var(--color-foreground)]',
          checked
            ? 'bg-accent border-accent text-accent-contrast'
            : 'border-border-strong bg-surface',
        )}
      >
        {checked ? <Check className="size-3" /> : null}
      </span>

      {recommended ? (
        <span className="bg-accent-soft text-accent-ink mb-2 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[length:var(--text-2xs)] font-medium tracking-[var(--tracking-wide)] uppercase">
          Recommended
        </span>
      ) : null}

      <span className="text-foreground pr-7 text-sm font-semibold">
        {title}
      </span>
      <span className="text-fg-muted mt-1 text-[length:var(--text-2xs)]">
        {description}
      </span>
      {metaText ? (
        <span className="text-fg-subtle mt-1 text-[length:var(--text-2xs)]">
          {metaText}
        </span>
      ) : null}
      <span className="text-foreground mt-auto pt-3 text-sm font-medium tabular-nums">
        {priceText}
      </span>
    </label>
  );
}

export function StepExtras({
  currency,
  selectedExtras,
  insuranceTier,
  onToggleExtra,
  onSelectInsurance,
}: StepExtrasProps): ReactNode {
  const { data: extras, isPending } = useExtras();

  const addOns: AddOnExtra[] = extras
    ? extras.filter((e): e is AddOnExtra => !isInsuranceExtra(e))
    : [];
  const tiers: InsuranceExtra[] = extras
    ? extras
        .filter(isInsuranceExtra)
        .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
    : [];

  return (
    <StepShell
      eyebrow="Step 3"
      title="Extras & cover"
      description="Add anything you need and choose your insurance. Everything is optional — the price updates as you go."
    >
      {isPending ? (
        <div
          className="grid gap-3"
          aria-busy="true"
          aria-label="Loading extras"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="border-border bg-surface h-16 animate-pulse rounded-[var(--radius-md)] border"
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-10">
          {/* ---- Add-ons (multi-select checkboxes) ----------------------- */}
          <fieldset>
            <legend className="text-fg-muted text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
              Add-ons
            </legend>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {addOns.map((extra) => {
                const checked = selectedExtras.includes(extra.id);
                return (
                  <label
                    key={extra.id}
                    className={cn(
                      'group flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-3 transition-colors',
                      checked
                        ? 'border-accent bg-accent-soft/40'
                        : 'border-border bg-surface hover:border-border-strong',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => { onToggleExtra(extra.id); }}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-xs)] border transition-colors',
                        'peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-[var(--color-foreground)]',
                        checked
                          ? 'bg-accent border-accent text-accent-contrast'
                          : 'border-border-strong bg-surface',
                      )}
                    >
                      {checked ? <Check className="size-3.5" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-foreground text-sm font-medium">
                          {extra.name}
                        </span>
                        <span className="text-fg-muted text-sm whitespace-nowrap tabular-nums">
                          {priceLabel(extra, currency)}
                        </span>
                      </span>
                      <span className="text-fg-subtle mt-0.5 block text-[length:var(--text-2xs)]">
                        {extra.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* ---- Insurance (single-choice tier) -------------------------- */}
          <fieldset>
            <legend className="text-fg-muted text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
              Insurance
            </legend>
            <div
              role="radiogroup"
              aria-label="Insurance tier"
              className="mt-3 grid gap-3 sm:grid-cols-3"
            >
              {/* The "no cover" option keeps the radio group honest (exactly-one
                  of the choices, including none) AND carries the SAME selected
                  indicator as the tier cards (A-16: one selection idiom). */}
              <InsuranceCard
                title="No extra cover"
                description="Standard liability only."
                priceText="Included"
                checked={insuranceTier === undefined}
                onSelect={() => { onSelectInsurance(undefined); }}
              />

              {tiers.map((tier) => {
                const checked = insuranceTier === tier.tier;
                return (
                  <InsuranceCard
                    key={tier.id}
                    title={tier.name}
                    description={tier.description}
                    metaText={`Excess ${formatCurrency(tier.excessMinor, currency)}`}
                    priceText={priceLabel(tier, currency)}
                    recommended={tier.tier === RECOMMENDED_TIER}
                    checked={checked}
                    onSelect={() => { onSelectInsurance(tier.tier); }}
                  />
                );
              })}
            </div>
          </fieldset>
        </div>
      )}
    </StepShell>
  );
}
