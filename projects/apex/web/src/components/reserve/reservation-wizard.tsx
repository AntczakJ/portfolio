'use client';

import { ArrowLeft, ArrowRight, RotateCcw, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { reserveVehicle } from '@/app/reserve/actions';
import {
  CONFIGURATOR_OPTIONS,
  getVehicleById,
  getVehicleBySlug,
} from '@/mocks';
import {
  useReservationStore,
  type WizardNotice,
} from '@/lib/store/reservation-store';
import {
  BOOKINGS,
} from '@/mocks';
import {
  canAdvance,
  canReachStep,
  draftToSubmit,
  stepIndex,
} from '@/lib/store/wizard-machine';
import type { Driver } from '@/lib/schemas/driver';

import { SummaryRail } from './summary-rail';
import { StepIndicator } from './step-indicator';
import { StepVehicle } from './step-vehicle';
import { StepDatesLocations } from './step-dates-locations';
import { StepExtras } from './step-extras';
import { StepDriver } from './step-driver';
import { StepConfirmation } from './step-confirmation';
import { useStepTransition } from './use-step-transition';

/**
 * The reservation wizard (Task 5.4-5.6) — the centerpiece INTERACTION.
 *
 * Orchestrates the five steps over the persisted Zustand store + the pure
 * wizard machine: the step indicator, back/next that preserve state, deep-link
 * seeding (`/reserve?vehicle=…&color=…&wheels=…`), the responsive summary rail
 * (sticky bottom bar on mobile), the rehydrate reconciliation notice, the GSAP
 * step-enter transition (ADR-002 — no Motion), and the mocked submit.
 *
 * Accessibility: the panel is an `aria-live` region; each step's heading takes
 * focus on mount (StepShell / StepConfirmation); steps are gated by the
 * machine's guards. SSR-safe: a skeleton renders until the persisted draft is
 * read (no `localStorage` on the server, no hydration mismatch).
 */

/** Public entry — `useSearchParams` requires a Suspense boundary on a static
 *  route, so the deep-link read is isolated here. */
export function ReservationWizard(): ReactNode {
  return (
    <Suspense fallback={<WizardSkeleton />}>
      <WizardWithParams />
    </Suspense>
  );
}

function WizardWithParams(): ReactNode {
  const searchParams = useSearchParams();
  const seed = useMemo(() => {
    const vehicleParam = searchParams.get('vehicle') ?? undefined;
    const colorParam = searchParams.get('color') ?? undefined;
    const wheelsParam = searchParams.get('wheels') ?? undefined;

    // Validate against the catalog; unknown params are ignored, not errored
    // (the razors-edge rule). `vehicle` is a SLUG in the deep link.
    const vehicle = vehicleParam ? getVehicleBySlug(vehicleParam) : undefined;
    const validColor =
      colorParam &&
      CONFIGURATOR_OPTIONS.colors.some((c) => c.id === colorParam)
        ? colorParam
        : undefined;
    const validWheel =
      wheelsParam &&
      CONFIGURATOR_OPTIONS.wheels.some((w) => w.id === wheelsParam)
        ? wheelsParam
        : undefined;

    return {
      vehicleId: vehicle?.id,
      config:
        validColor && validWheel
          ? { colorId: validColor, wheelId: validWheel }
          : undefined,
    };
  }, [searchParams]);

  return <WizardInner seed={seed} />;
}

interface WizardInnerProps {
  seed: { vehicleId: string | undefined; config: { colorId: string; wheelId: string } | undefined };
}

function WizardInner({ seed }: WizardInnerProps): ReactNode {
  const hydrated = useReservationStore((s) => s.hydrated);
  const step = useReservationStore((s) => s.step);
  const vehicleId = useReservationStore((s) => s.vehicleId);
  const config = useReservationStore((s) => s.config);
  const range = useReservationStore((s) => s.range);
  const pickupLocationId = useReservationStore((s) => s.pickupLocationId);
  const returnLocationId = useReservationStore((s) => s.returnLocationId);
  const extras = useReservationStore((s) => s.extras);
  const insuranceTier = useReservationStore((s) => s.insuranceTier);
  const driver = useReservationStore((s) => s.driver);
  const notice = useReservationStore((s) => s.notice);
  const confirmation = useReservationStore((s) => s.confirmation);

  const seedFromDeepLink = useReservationStore((s) => s.seedFromDeepLink);
  const selectVehicle = useReservationStore((s) => s.selectVehicle);
  const setRange = useReservationStore((s) => s.setRange);
  const setPickupLocation = useReservationStore((s) => s.setPickupLocation);
  const setReturnLocation = useReservationStore((s) => s.setReturnLocation);
  const toggleExtra = useReservationStore((s) => s.toggleExtra);
  const setInsuranceTier = useReservationStore((s) => s.setInsuranceTier);
  const setDriver = useReservationStore((s) => s.setDriver);
  const goToStep = useReservationStore((s) => s.goToStep);
  const next = useReservationStore((s) => s.next);
  const back = useReservationStore((s) => s.back);
  const dismissNotice = useReservationStore((s) => s.dismissNotice);
  const setConfirmation = useReservationStore((s) => s.setConfirmation);
  const reset = useReservationStore((s) => s.reset);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Seed from the deep link once, AFTER hydration, so a restored in-progress
  // draft is never clobbered. `seedFromDeepLink` only fills empty fields and
  // advances past the vehicle step when a vehicle is seeded.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!hydrated || seededRef.current) return;
    seededRef.current = true;
    if (seed.vehicleId || seed.config) {
      seedFromDeepLink({
        ...(seed.vehicleId !== undefined && { vehicleId: seed.vehicleId }),
        ...(seed.config !== undefined && { config: seed.config }),
      });
    }
  }, [hydrated, seed, seedFromDeepLink]);

  // Step transition (direction-aware GSAP enter).
  const panelRef = useRef<HTMLDivElement>(null);
  const prevIndexRef = useRef(stepIndex(step));
  const currentIndex = stepIndex(step);
  const direction = currentIndex >= prevIndexRef.current ? 1 : -1;
  useEffect(() => {
    prevIndexRef.current = currentIndex;
  }, [currentIndex]);
  useStepTransition(panelRef, step, direction);

  // Focus the step heading on a step CHANGE only — NOT on the initial mount
  // (A-09). The heading id is stable across all steps; skipping the first run
  // stops step 1's heading stealing focus + showing a ring on page load.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    // Defer a frame so the enter transition does not fight the focus scroll.
    const id = requestAnimationFrame(() => {
      document.getElementById('wizard-step-heading')?.focus();
    });
    return () => { cancelAnimationFrame(id); };
  }, [step]);

  // The draft snapshot the machine guards read.
  const draftSnapshot = useMemo(
    () => ({
      step,
      ...(vehicleId !== undefined && { vehicleId }),
      ...(config !== undefined && { config }),
      ...(range !== undefined && { range }),
      ...(pickupLocationId !== undefined && { pickupLocationId }),
      ...(returnLocationId !== undefined && { returnLocationId }),
      extras,
      ...(insuranceTier !== undefined && { insuranceTier }),
      ...(driver !== undefined && { driver }),
      savedAt: 0,
    }),
    [
      step,
      vehicleId,
      config,
      range,
      pickupLocationId,
      returnLocationId,
      extras,
      insuranceTier,
      driver,
    ],
  );

  const handleSubmit = useCallback(
    async (driverInput: Driver) => {
      setSubmitError(null);
      setDriver(driverInput);
      const submit = draftToSubmit({ ...draftSnapshot, driver: driverInput });
      if (!submit) {
        setSubmitError('Something is missing — please review your reservation.');
        return;
      }
      setSubmitting(true);
      try {
        const result = await reserveVehicle(submit);
        if (result.ok) {
          setConfirmation(result.confirmation);
        } else if (result.error === 'range-unavailable') {
          setSubmitError(
            'Those dates were just taken — please pick another range on step 2.',
          );
        } else {
          setSubmitError('We could not confirm your reservation. Please try again.');
        }
      } catch {
        setSubmitError('We could not confirm your reservation. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [draftSnapshot, setDriver, setConfirmation],
  );

  // Pre-hydration: SSR-safe skeleton (no localStorage read on the server).
  if (!hydrated) return <WizardSkeleton />;

  const isConfirmation = step === 'confirmation' && confirmation;

  if (isConfirmation) {
    return (
      <main id="main" className="mx-auto w-full max-w-5xl px-5 pt-28 pb-24 sm:px-8 sm:pt-32">
        <StepConfirmation
          confirmation={confirmation}
          onReserveAnother={() => {
            setSubmitError(null);
            reset();
          }}
        />
      </main>
    );
  }

  const advanceEnabled = canAdvance(draftSnapshot, step, BOOKINGS);
  const carriedVehicle = vehicleId ? getVehicleById(vehicleId) : undefined;
  const currency = carriedVehicle?.currency ?? 'EUR';

  // A step-specific hint for the disabled Continue (A-07) — what is still needed.
  const continueHint = ((): string => {
    switch (step) {
      case 'vehicle':
        return 'Choose a vehicle to continue.';
      case 'dates-locations':
        return !range
          ? 'Pick your dates to continue.'
          : 'Choose pick-up and return to continue.';
      default:
        return 'Complete this step to continue.';
    }
  })();

  // The mobile sticky-bar primary action. On the driver step it submits the
  // form (same validation + server action); otherwise it advances.
  const barPrimaryAction =
    step === 'driver'
      ? {
          label: submitting ? 'Confirming…' : 'Confirm',
          disabled: submitting,
          onClick: () => {
            const form = document.getElementById(
              'wizard-driver-form',
            ) as HTMLFormElement | null;
            form?.requestSubmit();
          },
        }
      : {
          label: 'Continue',
          disabled: !advanceEnabled,
          onClick: next,
        };

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-5xl px-5 pt-28 pb-40 sm:px-8 sm:pt-32 lg:pb-24"
    >
      {notice ? (
        <ReconcileNotice notice={notice} onDismiss={dismissNotice} />
      ) : null}

      <div className="mb-10 sm:mb-14">
        <StepIndicator
          current={step}
          canReach={(s) => canReachStep(draftSnapshot, s, BOOKINGS)}
          onGoToStep={goToStep}
        />
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
        {/* Step panel — the aria-live region. */}
        <div>
          <div ref={panelRef} aria-live="polite">
            {step === 'vehicle' ? (
              <StepVehicle
                selectedVehicleId={vehicleId}
                config={config}
                onSelect={selectVehicle}
              />
            ) : null}

            {step === 'dates-locations' ? (
              <StepDatesLocations
                vehicleId={vehicleId}
                range={range}
                pickupLocationId={pickupLocationId}
                returnLocationId={returnLocationId}
                onChangeRange={setRange}
                onChangePickup={setPickupLocation}
                onChangeReturn={setReturnLocation}
              />
            ) : null}

            {step === 'extras' ? (
              <StepExtras
                currency={currency}
                selectedExtras={extras}
                insuranceTier={insuranceTier}
                onToggleExtra={toggleExtra}
                onSelectInsurance={setInsuranceTier}
              />
            ) : null}

            {step === 'driver' ? (
              <StepDriver
                defaultValues={driver}
                submitting={submitting}
                submitError={submitError}
                onSubmit={(d) => {
                  void handleSubmit(d);
                }}
              />
            ) : null}
          </div>

          {/* Back / next + start over. */}
          <div className="mt-12 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={back}
              disabled={currentIndex === 0}
              className="text-fg-muted hover:text-foreground focus-visible:ring-ring inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="text-fg-subtle hover:text-foreground focus-visible:ring-ring inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Start over
              </button>

              {/* Desktop inline Continue — the driver step owns its own submit;
                  on mobile the sticky bar carries the CTA (so no duplicate). A
                  disabled Continue carries an associated, announced hint
                  explaining what is still needed (A-07), so it never reads as an
                  unexplained dead button. */}
              {step !== 'driver' ? (
                <div className="hidden flex-col items-end gap-1.5 lg:flex">
                  <button
                    type="button"
                    onClick={next}
                    disabled={!advanceEnabled}
                    aria-describedby={
                      !advanceEnabled ? 'wizard-continue-hint' : undefined
                    }
                    className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring inline-flex h-11 items-center gap-2 rounded-md px-7 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-40"
                  >
                    Continue
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                  {!advanceEnabled ? (
                    <p
                      id="wizard-continue-hint"
                      className="text-fg-subtle text-[length:var(--text-2xs)]"
                    >
                      {continueHint}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Desktop summary rail (from the dates step onward, once a vehicle is
            chosen). */}
        {vehicleId ? (
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <SummaryRail variant="rail" />
            </div>
          </aside>
        ) : null}
      </div>

      {/* Mobile sticky bar — carries the primary CTA + the live total. */}
      {vehicleId ? (
        <div className="border-border bg-background/92 fixed inset-x-0 bottom-0 z-30 border-t px-5 py-3 backdrop-blur-xl lg:hidden">
          <SummaryRail variant="bar" primaryAction={barPrimaryAction} />
        </div>
      ) : null}
    </main>
  );
}

function ReconcileNotice({
  notice,
  onDismiss,
}: {
  notice: WizardNotice;
  onDismiss: () => void;
}): ReactNode {
  const message =
    notice === 'range-unavailable'
      ? 'Your selected dates are no longer available — please pick another range. Everything else is as you left it.'
      : 'Your previous reservation draft had expired, so we started fresh.';

  return (
    <div
      role="status"
      className="border-accent/40 bg-accent-soft/40 mb-8 flex items-start justify-between gap-4 rounded-[var(--radius-md)] border px-4 py-3"
    >
      <p className="text-foreground text-sm">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-fg-muted hover:text-foreground focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Pre-hydration / Suspense skeleton — mirrors the hydrated shell's outer layout
 * so the swap on hydration does not shift the layout (CLS < 0.1).
 */
function WizardSkeleton(): ReactNode {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-5xl px-5 pt-28 pb-40 sm:px-8 sm:pt-32 lg:pb-24"
    >
      <div aria-hidden="true" className="mb-10 sm:mb-14">
        <div className="flex items-center justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <span className="bg-surface size-7 rounded-full" />
              <span className="bg-surface hidden h-3 w-16 rounded sm:block" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:gap-14">
        <div className="min-h-[28rem]">
          <div className="bg-surface h-4 w-20 rounded" />
          <div className="bg-surface mt-4 h-10 w-64 max-w-full rounded" />
          <p className="text-fg-subtle mt-10 text-sm">Loading the reservation…</p>
        </div>
        <div
          aria-hidden="true"
          className="bg-surface hidden h-80 rounded-[var(--radius-xl)] lg:block"
        />
      </div>
    </main>
  );
}
