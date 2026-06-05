import {
  BatteryCharging,
  CalendarRange,
  Car,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';

import { TrackLine } from '@/components/chrome/track-line';

import { Reveal } from './reveal';

/**
 * How it works / why APEX (Task 5.1) — the value section.
 *
 * A SERVER component, in the restrained Linear/Vercel register: a four-step
 * rental process (the "how"), then the differentiators (the "why") — dense
 * without being busy, confident, no decoration that does not earn its place.
 * The track-line motif separates the two halves. The step numbers and the
 * differentiator cards reveal on scroll (`Reveal`; reduced-motion -> static).
 */

interface Step {
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly Step[] = [
  {
    icon: Car,
    title: 'Pick your car',
    body: 'Browse the fleet or configure the flagship live — paint, wheels, the exact car you want.',
  },
  {
    icon: CalendarRange,
    title: 'Choose dates & places',
    body: 'Set your range and your pick-up and return points. Availability is live as you choose.',
  },
  {
    icon: Sparkles,
    title: 'Add the extras',
    body: 'Child seat, extra driver, the cover that suits you. The price updates as you go.',
  },
  {
    icon: KeyRound,
    title: 'Reserve & go',
    body: 'Confirm in minutes. Collect a car that is clean, charged, and ready when you are.',
  },
];

interface ValueProp {
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly title: string;
  readonly body: string;
}

const VALUE_PROPS: readonly ValueProp[] = [
  {
    icon: Zap,
    title: 'Effortless performance',
    body: 'Composed, immediate response and a refined drive from the first metre — every car in the line-up.',
  },
  {
    icon: BatteryCharging,
    title: 'Ready when you are',
    body: 'Every car is handed over fully prepared and topped up, so you set off the moment you collect it.',
  },
  {
    icon: ShieldCheck,
    title: 'Cover that makes sense',
    body: 'Three clear insurance tiers, no fine-print surprises, and round-the-clock roadside support.',
  },
  {
    icon: Sparkles,
    title: 'A premium hand-over',
    body: 'Spotless interiors and a clean-car guarantee on every reservation, from city compact to flagship.',
  },
];

export function HowItWorksSection(): ReactNode {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className="bg-surface border-border relative scroll-mt-[var(--header-height,4rem)] border-y"
    >
      <div className="mx-auto max-w-[var(--width-content,80rem)] px-[var(--space-gutter,1.25rem)] py-[var(--space-section,6rem)]">
        {/* ---- How it works ------------------------------------------------- */}
        <Reveal className="max-w-2xl">
          <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
            How it works
          </p>
          <h2
            id="how-heading"
            className="font-display text-foreground mt-3 text-[length:var(--text-3xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance"
          >
            Reserve a premium EV in four steps
          </h2>
        </Reveal>

        <Reveal
          stagger
          className="mt-12 grid gap-px overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-4"
        >
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                data-reveal-item
                className="bg-surface group relative flex flex-col gap-4 p-6 sm:p-7"
              >
                {/* A hairline accent rule along the card top that lights on hover
                    — the track-line motif at card scale (A-19). Decorative. */}
                <span
                  aria-hidden="true"
                  className="bg-accent absolute inset-x-0 top-0 h-px origin-left scale-x-0 transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:scale-x-100 motion-reduce:transition-none"
                />
                <div className="flex items-center justify-between">
                  <span className="bg-accent-soft text-accent-ink inline-flex size-10 items-center justify-center rounded-[var(--radius-md)]">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span
                    aria-hidden="true"
                    className="font-display text-fg-subtle/50 text-[length:var(--text-2xl)] font-semibold tabular-nums"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>
                <div>
                  <h3 className="text-foreground text-[length:var(--text-lg)] font-semibold">
                    {step.title}
                  </h3>
                  <p className="text-fg-muted mt-2 text-sm leading-[var(--leading-normal)]">
                    {step.body}
                  </p>
                </div>
              </div>
            );
          })}
        </Reveal>

        <TrackLine className="my-16" />

        {/* ---- Why APEX ----------------------------------------------------- */}
        <Reveal className="max-w-2xl">
          <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
            Why APEX
          </p>
          <h2 className="font-display text-foreground mt-3 text-[length:var(--text-3xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance">
            The premium-EV difference, by the day
          </h2>
        </Reveal>

        <Reveal stagger className="mt-12 grid gap-6 sm:grid-cols-2">
          {VALUE_PROPS.map((vp) => {
            const Icon = vp.icon;
            return (
              <div
                key={vp.title}
                data-reveal-item
                className="border-border bg-background hover:border-accent/40 group flex gap-4 rounded-[var(--radius-lg)] border p-6 transition-[transform,border-color] duration-300 ease-[var(--ease-out-expo)] hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="text-accent-ink shrink-0 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
                  <Icon className="size-6" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-foreground text-[length:var(--text-lg)] font-semibold">
                    {vp.title}
                  </h3>
                  <p className="text-fg-muted mt-2 text-sm leading-[var(--leading-normal)] text-balance">
                    {vp.body}
                  </p>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
