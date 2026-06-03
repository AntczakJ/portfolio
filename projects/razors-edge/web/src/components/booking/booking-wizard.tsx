'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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

import { cn } from '@/lib/cn';
import { bookAppointment } from '@/app/book/actions';
import { getBarberById, getServiceById } from '@/mocks';
import {
  canReachStep,
  earliestIncompleteStep,
  stepIndex,
  useBookingStore,
  type WizardNotice,
} from '@/lib/store/booking-store';
import { draftToSubmission } from '@/lib/store/booking-machine';
import type { ContactDetails } from '@/lib/schemas/contact';
import type { SeedParams } from '@/lib/store/booking-machine';

import { StepBarber } from './step-barber';
import { StepConfirmation } from './step-confirmation';
import { StepDateTime } from './step-datetime';
import { StepDetails } from './step-details';
import { StepService } from './step-service';
import { STEP_DEFS } from './wizard-steps';
import { WizardProgress } from './wizard-progress';
import { WizardSummary } from './wizard-summary';
import { makeStepVariants } from './wizard-motion';

interface BookingWizardInnerProps {
  /** Deep-link preselect params (validated against the catalog). */
  seed: SeedParams;
}

/**
 * Public entry. The `/book` route is STATIC (so its metadata stays in the
 * head — Lighthouse SEO), so the deep-link preselect (`?service=`/`?barber=`)
 * is read CLIENT-side here via `useSearchParams`, validated against the mock
 * catalog (unknown ids ignored, ADR-003), and passed to the wizard. The
 * `useSearchParams` read is wrapped in `<Suspense>` per Next's requirement
 * for a static route; the fallback is the same pre-hydration skeleton the
 * wizard shows.
 */
export function BookingWizard(): ReactNode {
  return (
    <Suspense fallback={<WizardShellSkeleton />}>
      <BookingWizardWithParams />
    </Suspense>
  );
}

function BookingWizardWithParams(): ReactNode {
  const searchParams = useSearchParams();
  const seed = useMemo<SeedParams>(() => {
    const serviceParam = searchParams.get('service') ?? undefined;
    const barberParam = searchParams.get('barber') ?? undefined;
    return {
      service:
        serviceParam && getServiceById(serviceParam) ? serviceParam : undefined,
      barber:
        barberParam && getBarberById(barberParam) ? barberParam : undefined,
    };
  }, [searchParams]);

  return <BookingWizardInner seed={seed} />;
}

/**
 * The booking wizard shell (ADR-002 + ADR-003) — the centerpiece
 * interaction.
 *
 * Orchestrates the five steps over the persisted Zustand machine: step
 * enter/exit via Motion `AnimatePresence` (the ONE place Motion earns its
 * bundle, scoped to React-state component transitions per ADR-002, with a
 * reduced-motion branch); the progress indicator; back/next that preserves
 * state; deep-link seeding; the responsive summary rail (sticky bottom bar
 * on mobile); the rehydrate-reconciliation notice; and the mocked submit.
 *
 * Accessibility: on each step change focus moves to the step heading
 * (`#wizard-step-heading`), the panel is an `aria-live` region so the new
 * heading is announced, and the step is gated by the machine's guards.
 */
function BookingWizardInner({ seed }: BookingWizardInnerProps): ReactNode {
  const draft = useBookingStore((s) => s.draft);
  const notice = useBookingStore((s) => s.notice);
  const confirmation = useBookingStore((s) => s.confirmation);
  const hydrated = useBookingStore((s) => s.hydrated);

  const selectService = useBookingStore((s) => s.selectService);
  const selectBarber = useBookingStore((s) => s.selectBarber);
  const selectDate = useBookingStore((s) => s.selectDate);
  const selectSlot = useBookingStore((s) => s.selectSlot);
  const pinResolvedBarber = useBookingStore((s) => s.pinResolvedBarber);
  const setContact = useBookingStore((s) => s.setContact);
  const goToStep = useBookingStore((s) => s.goToStep);
  const next = useBookingStore((s) => s.next);
  const back = useBookingStore((s) => s.back);
  const seedIfEmpty = useBookingStore((s) => s.seedIfEmpty);
  const dismissNotice = useBookingStore((s) => s.dismissNotice);
  const setConfirmation = useBookingStore((s) => s.setConfirmation);
  const reset = useBookingStore((s) => s.reset);

  const reduce = useReducedMotion() ?? false;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Track step direction for the slide variant.
  const prevIndexRef = useRef<number>(stepIndex(draft.step));
  const currentIndex = stepIndex(draft.step);
  const direction = currentIndex >= prevIndexRef.current ? 1 : -1;

  // Seed from deep-link params once, after hydration (so we never clobber a
  // restored in-progress draft).
  useEffect(() => {
    if (hydrated) seedIfEmpty(seed);
  }, [hydrated, seed, seedIfEmpty]);

  // Keep the direction ref current for the slide variant. Focus management on
  // step change (D-A11Y-2) is owned by the step heading's OWN mount effect
  // (StepShell / StepConfirmation via `useFocusStepHeadingOnMount`), which
  // lands focus exactly when the incoming heading mounts after the
  // AnimatePresence `mode="wait"` exit — robust, no timing guess.
  useEffect(() => {
    prevIndexRef.current = currentIndex;
  }, [currentIndex]);

  const handleSubmit = useCallback(
    async (contact: ContactDetails) => {
      setSubmitError(null);
      setContact(contact);
      const submission = draftToSubmission({ ...draft, contact });
      if (!submission) {
        setSubmitError('Something is missing — please review your booking.');
        return;
      }
      setSubmitting(true);
      try {
        const result = await bookAppointment(submission);
        if (result.ok) {
          setConfirmation(result.confirmation);
        } else if (result.error === 'slot-taken') {
          setSubmitError(
            'That time was just taken. Please pick another on the previous step.',
          );
        } else {
          setSubmitError(
            'We could not confirm your booking. Please try again.',
          );
        }
      } catch {
        setSubmitError('We could not confirm your booking. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [draft, setContact, setConfirmation],
  );

  // Pre-hydration: render a minimal, non-interactive frame so SSR + the
  // first client paint agree (no localStorage read on the server).
  if (!hydrated) {
    return <WizardShellSkeleton />;
  }

  const isConfirmation = draft.step === 'confirmation' && confirmation;
  const variants = makeStepVariants(reduce);
  const furthest = earliestIncompleteStep(draft);
  const canAdvance =
    stepIndex(draft.step) < stepIndex(furthest) &&
    draft.step !== 'confirmation';

  // The mobile sticky-bar primary action (D-08). On the details step it
  // submits the form (so the same validation + server action runs); on the
  // earlier steps it advances when the step's selection is complete.
  const barPrimaryAction =
    draft.step === 'details'
      ? {
          label: submitting ? 'Confirming…' : 'Confirm',
          disabled: submitting,
          onClick: () => {
            const form = document.getElementById(
              'wizard-details-form',
            ) as HTMLFormElement | null;
            form?.requestSubmit();
          },
        }
      : {
          label: 'Continue',
          disabled: !canAdvance,
          onClick: next,
        };

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-5xl px-5 pt-28 pb-40 sm:px-8 sm:pt-32 lg:pb-24"
    >
      {/* Reconciliation / expiry notice (calm, non-blocking, dismissible). */}
      {notice ? (
        <ReconcileNotice notice={notice} onDismiss={dismissNotice} />
      ) : null}

      {/* Progress (hidden on the confirmation step — it is terminal). */}
      {!isConfirmation ? (
        <div className="mb-10 sm:mb-14">
          <WizardProgress
            current={draft.step}
            currentIndex={currentIndex}
            canReach={(step) => canReachStep(draft, step)}
            onGoToStep={goToStep}
          />
        </div>
      ) : null}

      <div
        className={cn(
          'grid gap-10',
          !isConfirmation && 'lg:grid-cols-[1fr_20rem] lg:gap-16',
        )}
      >
        {/* Step panel — the aria-live region. */}
        <div aria-live="polite">
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={draft.step}
              custom={direction}
              variants={variants}
              initial="initial"
              animate="enter"
              exit="exit"
            >
              {draft.step === 'service' ? (
                <StepService
                  selectedId={draft.serviceId}
                  onSelect={selectService}
                />
              ) : null}

              {draft.step === 'barber' && draft.serviceId ? (
                <StepBarber
                  serviceId={draft.serviceId}
                  selectedBarberId={draft.barberId}
                  anyBarber={draft.anyBarber}
                  onSelectBarber={(id) => {
                    selectBarber(id);
                  }}
                  onSelectAny={() => {
                    selectBarber(null, true);
                  }}
                />
              ) : null}

              {draft.step === 'date-time' && draft.serviceId ? (
                <StepDateTime
                  serviceId={draft.serviceId}
                  barberId={draft.barberId}
                  anyBarber={draft.anyBarber}
                  date={draft.date}
                  startMin={draft.startMin}
                  onSelectDate={selectDate}
                  onSelectSlot={selectSlot}
                  onResolveBarber={pinResolvedBarber}
                />
              ) : null}

              {draft.step === 'details' ? (
                <StepDetails
                  defaultValues={draft.contact}
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  submitError={submitError}
                />
              ) : null}

              {isConfirmation ? (
                <StepConfirmation
                  confirmation={confirmation}
                  onBookAnother={() => {
                    setSubmitError(null);
                    reset();
                  }}
                />
              ) : null}
            </motion.div>
          </AnimatePresence>

          {/* Back / next + start over — hidden on confirmation + details
              (details owns its own submit button). */}
          {!isConfirmation ? (
            <div className="mt-12 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={back}
                disabled={currentIndex === 0}
                className="text-fg-muted hover:text-fg focus-visible:ring-ring inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-0"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className="text-fg-subtle hover:text-fg focus-visible:ring-ring inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  Start over
                </button>

                {/* Desktop inline Continue — on mobile the sticky bar carries
                    it (D-08), so this is hidden below lg to avoid a duplicate. */}
                {draft.step !== 'details' ? (
                  <button
                    type="button"
                    onClick={next}
                    disabled={!canAdvance}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring hidden h-10 items-center gap-2 rounded-md px-6 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none disabled:opacity-40 lg:inline-flex"
                  >
                    Continue
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Desktop summary rail. */}
        {!isConfirmation ? (
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <WizardSummary draft={draft} variant="rail" />
            </div>
          </aside>
        ) : null}
      </div>

      {/* Mobile sticky summary bar — now carries the primary advance CTA so
          it is never below the fold (D-08). */}
      {!isConfirmation && draft.serviceId ? (
        <div className="border-border bg-bg/92 fixed inset-x-0 bottom-0 z-30 border-t px-5 py-3 backdrop-blur-xl lg:hidden">
          <WizardSummary
            draft={draft}
            variant="bar"
            primaryAction={barPrimaryAction}
          />
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
    notice === 'slot-taken'
      ? 'That time was just taken — please pick another. Everything else is as you left it.'
      : 'Your previous booking draft had expired, so we started fresh.';

  return (
    <div
      role="status"
      className="border-brass-muted/50 bg-surface/50 mb-8 flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
    >
      <p className="text-fg text-sm">
        <span aria-hidden="true" className="text-brass-text mr-2">
          —
        </span>
        {message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-fg-subtle hover:text-fg focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Pre-hydration placeholder — keeps the first paint stable + on-brand.
 *
 * CLS fix: this skeleton mirrors the hydrated shell's outer layout EXACTLY —
 * same `<main>` padding, the same progress-bar block (margins included), and
 * a `min-h` on the body region that reserves the panel + summary footprint —
 * so when the wizard hydrates and swaps the skeleton for the real step, the
 * layout above the fold does not move (CLS < 0.1). The progress bar here uses
 * the same `mb-10 sm:mb-14` rhythm as `WizardProgress`'s wrapper, and the
 * heading placeholders match the step shell's eyebrow + h1 metrics.
 */
function WizardShellSkeleton(): ReactNode {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-5xl px-5 pt-28 pb-40 sm:px-8 sm:pt-32 lg:pb-24"
    >
      {/* Mirror WizardProgress's height exactly so the heading below does not
          shift on hydration: the compact mobile "Step N of 5" line (sm:hidden)
          + the marker row (size-6/sm:size-7 + the sm:block label slot). */}
      <nav aria-hidden="true" className="mb-10 w-full sm:mb-14">
        <div className="bg-surface/50 mb-4 h-5 w-40 rounded sm:hidden" />
        <div className="flex items-center justify-between">
          {STEP_DEFS.map((d) => (
            <div key={d.step} className="flex flex-col items-center gap-2">
              <span className="bg-surface/50 size-6 rounded-full sm:size-7" />
              <span className="bg-surface/40 hidden h-3 w-12 rounded sm:block" />
            </div>
          ))}
        </div>
      </nav>
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:gap-16">
        <div className="min-h-[28rem]">
          <div className="bg-surface/60 h-4 w-24 rounded" />
          <div className="bg-surface/40 mt-4 h-12 w-72 max-w-full rounded" />
          <div className="bg-surface/30 mt-4 h-5 w-full max-w-xl rounded" />
          <p className="text-fg-subtle mt-10 text-sm">
            Loading the booking flow…
          </p>
        </div>
        <div
          aria-hidden="true"
          className="bg-surface/20 hidden h-72 rounded-lg lg:block"
        />
      </div>
    </main>
  );
}
