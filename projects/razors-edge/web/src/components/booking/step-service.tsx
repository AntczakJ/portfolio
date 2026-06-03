'use client';

import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { formatDuration, formatPrice, formatCategory } from '@/lib/format';
import { useServices } from '@/lib/queries/booking-queries';
import { cn } from '@/lib/cn';
import type { ServiceCategory } from '@/lib/schemas/common';
import type { Service } from '@/lib/schemas/service';

import { StepShell } from './step-shell';
import { rovingTabIndex, useRadiogroupKeys } from './use-radiogroup-keys';

interface StepServiceProps {
  selectedId: string | undefined;
  onSelect: (serviceId: string) => void;
}

const CATEGORY_ORDER: readonly ServiceCategory[] = [
  'cut',
  'beard',
  'shave',
  'combo',
];

/**
 * Step 1 — pick a service (ADR-003).
 *
 * Reads the menu through TanStack Query (`useServices`) so the loading
 * ergonomics are real even though the source is local + seeded. Groups by
 * category (Cuts / Beard / Shave / Combinations), each service a selectable
 * card with duration + price; combos carry the brass "Combo" tag. Choosing
 * a service advances to the barber step.
 *
 * Each option is a real radio (a `radiogroup` of `radio`s) so the whole
 * step is keyboard-operable with arrow keys + space, with the chosen card
 * carrying `aria-checked`.
 */
export function StepService({
  selectedId,
  onSelect,
}: StepServiceProps): ReactNode {
  const { data: services, isPending, isError } = useServices();

  const groups = (services ?? []).reduce<
    Record<ServiceCategory, Service[]>
  >(
    (acc, service) => {
      acc[service.category].push(service);
      return acc;
    },
    { cut: [], beard: [], shave: [], combo: [] },
  );

  // A flat list of services in render order (category order, then within
  // each category). The radiogroup keyboard pattern uses each service's
  // position here as its `data-rg-index`, so arrow keys roam across the
  // whole group regardless of the fieldset grouping.
  const orderedServices = CATEGORY_ORDER.flatMap((c) => groups[c]);
  // selectOnMove: false — selecting a service auto-advances the wizard, so
  // arrow keys move focus only and Space/Enter commits (D-A11Y-1).
  const handleKeyDown = useRadiogroupKeys(
    (index) => {
      const service = orderedServices[index];
      if (service) onSelect(service.id);
    },
    { selectOnMove: false },
  );
  const anySelected = orderedServices.some((s) => s.id === selectedId);

  return (
    <StepShell
      eyebrow="Step one"
      title="What are you in for?"
      lead="Pick a service. Every chair includes a consultation and a clean finish — the price you see is the price you pay."
    >
      {isError ? (
        <p role="alert" className="text-danger text-sm">
          We could not load the menu. Please refresh and try again.
        </p>
      ) : isPending ? (
        <ServiceSkeleton />
      ) : (
        <div
          role="radiogroup"
          aria-label="Choose a service"
          // Roving-tabindex composite: focus lives on the radios; `tabIndex={-1}`
          // keeps the group a valid keydown focus host, out of the tab sequence.
          tabIndex={-1}
          className="flex flex-col gap-10"
          onKeyDown={handleKeyDown}
        >
          {CATEGORY_ORDER.filter((c) => groups[c].length > 0).map(
            (category) => (
              <fieldset key={category} className="border-0 p-0">
                <legend className="text-fg-subtle mb-4 text-xs tracking-[0.18em] uppercase">
                  {formatCategory(category)}
                </legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {groups[category].map((service) => {
                    const flatIndex = orderedServices.indexOf(service);
                    const checked = service.id === selectedId;
                    return (
                      <ServiceOption
                        key={service.id}
                        service={service}
                        index={flatIndex}
                        checked={checked}
                        tabIndex={rovingTabIndex({
                          isSelected: checked,
                          anySelected,
                          isFirstSelectable: flatIndex === 0,
                        })}
                        onSelect={() => {
                          onSelect(service.id);
                        }}
                      />
                    );
                  })}
                </div>
              </fieldset>
            ),
          )}
        </div>
      )}
    </StepShell>
  );
}

function ServiceOption({
  service,
  index,
  checked,
  tabIndex,
  onSelect,
}: {
  service: Service;
  index: number;
  checked: boolean;
  tabIndex: 0 | -1;
  onSelect: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      data-rg-index={index}
      onClick={onSelect}
      className={cn(
        'group focus-visible:ring-ring relative flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none',
        checked
          ? 'border-[var(--color-edge-glow)] bg-surface/60'
          : 'border-border bg-surface/20 hover:border-border-strong hover:bg-surface/40',
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="font-display text-fg text-[length:var(--text-body-lg)] [font-variation-settings:'opsz'_40,'wght'_500]">
            {service.name}
          </span>
          {service.category === 'combo' ? (
            <span className="border-brass-muted/60 text-brass-text rounded-full border px-2 py-0.5 text-[0.5625rem] tracking-[0.18em] uppercase">
              Combo
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors',
            checked
              ? 'border-[var(--color-edge-glow)] bg-[var(--color-edge-glow)] text-[var(--color-on-brass)]'
              : 'border-border-strong text-transparent',
          )}
        >
          <Check className="size-3" />
        </span>
      </span>

      <span className="text-fg-muted text-sm leading-relaxed">
        {service.description}
      </span>

      <span className="text-fg-subtle mt-1 flex items-center gap-3 text-sm tabular-nums">
        <span className="text-brass-text">
          {formatPrice(service.priceMinor, service.currency)}
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatDuration(service.durationMin)}</span>
        {service.popular ? (
          <span className="text-fg-subtle ml-auto text-[0.625rem] tracking-[0.16em] uppercase">
            Most booked
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ServiceSkeleton(): ReactNode {
  return (
    <div aria-hidden="true" className="flex flex-col gap-10">
      {[0, 1].map((g) => (
        <div key={g} className="flex flex-col gap-4">
          <div className="bg-surface/60 h-3 w-20 rounded" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="border-border bg-surface/20 h-28 animate-pulse rounded-lg border"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
