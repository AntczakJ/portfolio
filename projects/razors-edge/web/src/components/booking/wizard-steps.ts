import type { BookingStep } from '@/lib/schemas/booking';

/**
 * Static step metadata for the wizard chrome (progress indicator + the
 * heading each step focuses on advance). Kept here so the order + labels
 * live in one place, matching `STEP_ORDER` in the machine.
 */
export interface StepDef {
  step: BookingStep;
  /** Short label for the progress rail. */
  label: string;
  /** The editorial heading shown at the top of the step panel. */
  title: string;
  /** The brass eyebrow kicker. */
  eyebrow: string;
}

/** The first step's metadata — also the safe fallback for `stepDef`. */
const SERVICE_STEP_DEF: StepDef = {
  step: 'service',
  label: 'Service',
  title: 'What are you in for?',
  eyebrow: 'Step one',
};

export const STEP_DEFS: readonly StepDef[] = [
  SERVICE_STEP_DEF,
  {
    step: 'barber',
    label: 'Barber',
    title: 'Whose chair?',
    eyebrow: 'Step two',
  },
  {
    step: 'date-time',
    label: 'Date & time',
    title: 'When suits you?',
    eyebrow: 'Step three',
  },
  {
    step: 'details',
    label: 'Details',
    title: 'Your details.',
    eyebrow: 'Step four',
  },
  {
    step: 'confirmation',
    label: 'Confirmation',
    title: 'You are booked in.',
    eyebrow: 'Confirmed',
  },
];

export function stepDef(step: BookingStep): StepDef {
  return STEP_DEFS.find((d) => d.step === step) ?? SERVICE_STEP_DEF;
}
