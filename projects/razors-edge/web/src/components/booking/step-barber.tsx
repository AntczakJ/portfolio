'use client';

import { Check, Sparkles } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { formatCategory } from '@/lib/format';
import { useBarbers } from '@/lib/queries/booking-queries';
import { cn } from '@/lib/cn';
import type { Barber } from '@/lib/schemas/barber';

import { StepShell } from './step-shell';
import { rovingTabIndex, useRadiogroupKeys } from './use-radiogroup-keys';

interface StepBarberProps {
  serviceId: string;
  selectedBarberId: string | undefined;
  anyBarber: boolean | undefined;
  onSelectBarber: (barberId: string) => void;
  onSelectAny: () => void;
}

/**
 * Step 2 — pick a barber (ADR-003).
 *
 * Filtered to barbers who perform the chosen service (the barber's
 * `serviceIds` includes the service id). An "Any available barber" option
 * leads the list (resolved to a concrete barber at date/time selection).
 * Each barber shows the graded portrait, name, title, and specialties.
 *
 * A `radiogroup` of `radio`s — fully keyboard-operable; the chosen card
 * carries `aria-checked`.
 */
export function StepBarber({
  serviceId,
  selectedBarberId,
  anyBarber,
  onSelectBarber,
  onSelectAny,
}: StepBarberProps): ReactNode {
  const { data: barbers, isPending, isError } = useBarbers();

  const eligible = (barbers ?? []).filter((b) =>
    b.serviceIds.includes(serviceId),
  );

  // Flat radiogroup order: "Any available barber" (index 0) then each
  // eligible barber. Arrow keys roam this whole ordering.
  const anyChecked = anyBarber === true;
  // selectOnMove: false — selecting a barber auto-advances the wizard, so
  // arrow keys move focus only and Space/Enter commits (D-A11Y-1).
  const handleKeyDown = useRadiogroupKeys(
    (index) => {
      if (index === 0) {
        onSelectAny();
        return;
      }
      const barber = eligible[index - 1];
      if (barber) onSelectBarber(barber.id);
    },
    { selectOnMove: false },
  );
  // When this OR short-circuits past `anyChecked`, `anyBarber` is not `true`,
  // so the redundant `!anyBarber` guard is dropped (it is always truthy here).
  const anySelected =
    anyChecked || eligible.some((b) => b.id === selectedBarberId);

  return (
    <StepShell
      eyebrow="Step two"
      title="Whose chair?"
      lead="Each barber has a specialism. Pick the one whose craft fits your cut — or let us seat you with whoever is free first."
    >
      {isError ? (
        <p role="alert" className="text-danger text-sm">
          We could not load the team. Please refresh and try again.
        </p>
      ) : isPending ? (
        <BarberSkeleton />
      ) : (
        <div
          role="radiogroup"
          aria-label="Choose a barber"
          // Roving-tabindex composite: focus lives on the radios; `tabIndex={-1}`
          // keeps the group a valid keydown focus host, out of the tab sequence.
          tabIndex={-1}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onKeyDown={handleKeyDown}
        >
          <AnyBarberOption
            index={0}
            checked={anyChecked}
            tabIndex={rovingTabIndex({
              isSelected: anyChecked,
              anySelected,
              isFirstSelectable: true,
            })}
            onSelect={onSelectAny}
          />
          {eligible.map((barber, i) => {
            const checked = !anyBarber && barber.id === selectedBarberId;
            return (
              <BarberOption
                key={barber.id}
                barber={barber}
                index={i + 1}
                checked={checked}
                tabIndex={rovingTabIndex({
                  isSelected: checked,
                  anySelected,
                  isFirstSelectable: false,
                })}
                onSelect={() => {
                  onSelectBarber(barber.id);
                }}
              />
            );
          })}
        </div>
      )}
    </StepShell>
  );
}

function AnyBarberOption({
  index,
  checked,
  tabIndex,
  onSelect,
}: {
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
        'group focus-visible:ring-ring relative flex items-center gap-4 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none sm:col-span-2',
        checked
          ? 'border-[var(--color-edge-glow)] bg-surface/60'
          : 'border-border bg-surface/20 hover:border-border-strong hover:bg-surface/40',
      )}
    >
      <span className="bg-surface-raised text-brass-text flex size-14 shrink-0 items-center justify-center rounded-md">
        <Sparkles className="size-6" aria-hidden="true" />
      </span>
      <span className="flex flex-1 flex-col">
        <span className="font-display text-fg text-[length:var(--text-body-lg)] [font-variation-settings:'opsz'_40,'wght'_500]">
          Any available barber
        </span>
        <span className="text-fg-muted text-sm">
          We will seat you with the first barber free for your service.
        </span>
      </span>
      <SelectMark checked={checked} />
    </button>
  );
}

function BarberOption({
  barber,
  index,
  checked,
  tabIndex,
  onSelect,
}: {
  barber: Barber;
  index: number;
  checked: boolean;
  tabIndex: 0 | -1;
  onSelect: () => void;
}): ReactNode {
  // D-09: at most two specialty tags, the rest collapsed to "+N" — never a
  // CSS "..." truncation that hides what the barber does.
  const MAX_TAGS = 2;
  const shownTags = barber.specialties.slice(0, MAX_TAGS);
  const extraTags = barber.specialties.length - shownTags.length;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={tabIndex}
      data-rg-index={index}
      onClick={onSelect}
      className={cn(
        'group focus-visible:ring-ring relative flex items-stretch gap-4 overflow-hidden rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none',
        checked
          ? 'border-[var(--color-edge-glow)] bg-surface/60'
          : 'border-border bg-surface/20 hover:border-border-strong hover:bg-surface/40',
      )}
    >
      {/* Enlarged portrait — a 4:5 crop closer to the homepage barber card,
          with a brass under-edge on hover/selection echoing those cards. */}
      <span className="relative aspect-[4/5] w-24 shrink-0 self-center overflow-hidden rounded-md sm:w-[6.5rem]">
        <Image
          src={barber.portrait.src}
          alt=""
          fill
          sizes="7rem"
          placeholder="blur"
          blurDataURL={barber.portrait.blurDataURL}
          className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 bottom-0 h-px origin-left bg-[var(--color-edge-glow)] transition-transform duration-300',
            checked ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
          )}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center py-1">
        <span className="font-display text-fg text-[length:var(--text-body-lg)] [font-variation-settings:'opsz'_40,'wght'_500]">
          {barber.name}
        </span>
        <span className="text-fg-muted text-sm">{barber.title}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {shownTags.map((category) => (
            <span
              key={category}
              className="border-border text-fg-subtle rounded-full border px-2 py-0.5 text-[0.625rem] tracking-[0.06em] uppercase"
            >
              {formatCategory(category)}
            </span>
          ))}
          {extraTags > 0 ? (
            <span className="text-fg-subtle text-[0.625rem] tracking-[0.06em] uppercase">
              +{extraTags}
            </span>
          ) : null}
        </span>
      </span>
      <SelectMark checked={checked} />
    </button>
  );
}

function SelectMark({ checked }: { checked: boolean }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center self-start rounded-full border transition-colors',
        checked
          ? 'border-[var(--color-edge-glow)] bg-[var(--color-edge-glow)] text-[var(--color-on-brass)]'
          : 'border-border-strong text-transparent',
      )}
    >
      <Check className="size-3" />
    </span>
  );
}

function BarberSkeleton(): ReactNode {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="border-border bg-surface/20 h-24 animate-pulse rounded-lg border"
        />
      ))}
    </div>
  );
}
