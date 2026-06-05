'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useId, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';

import { cn } from '@/lib/cn';
import { driverSchema, type Driver } from '@/lib/schemas/driver';

import { StepShell } from './step-shell';

/**
 * Step 4 — Driver details (Task 5.6).
 *
 * react-hook-form + `zodResolver` over the SHARED `driverSchema` (the same
 * schema the server action re-validates — § 5). Accessible inline validation:
 * every input has a `<label>`, errors are wired via `aria-describedby` +
 * `aria-invalid` and announced (`role="alert"`). The licence is FORMAT-only (the
 * schema's regex — no real verification, the demo collects no real PII).
 *
 * The form has a stable id so the mobile sticky bar can `requestSubmit()` it
 * (the same validation + submit path runs from either trigger). Submitting calls
 * `onSubmit` with the parsed driver; the wizard shell drives the server action.
 */
interface StepDriverProps {
  defaultValues: Partial<Driver> | undefined;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (driver: Driver) => void;
}

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode;
  hint?: string | undefined;
}

function Field({ id, label, error, children, hint }: FieldProps): ReactNode {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div>
      <label
        htmlFor={id}
        className="text-foreground block text-sm font-medium"
      >
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-fg-subtle mt-0.5 text-[length:var(--text-2xs)]">
          {hint}
        </p>
      ) : null}
      <div className="mt-1.5">{children(describedBy, Boolean(error))}</div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-danger-ink mt-1.5 text-[length:var(--text-xs)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function StepDriver({
  defaultValues,
  submitting,
  submitError,
  onSubmit,
}: StepDriverProps): ReactNode {
  const formId = 'wizard-driver-form';
  const errorSummaryId = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Driver>({
    resolver: zodResolver(driverSchema),
    mode: 'onBlur',
    defaultValues: {
      name: defaultValues?.name ?? '',
      email: defaultValues?.email ?? '',
      phone: defaultValues?.phone ?? '',
      licenceNo: defaultValues?.licenceNo ?? '',
      ...(defaultValues?.notes !== undefined && { notes: defaultValues.notes }),
    },
  });

  const inputClass = (invalid: boolean): string =>
    cn(
      'bg-surface text-foreground placeholder:text-fg-subtle h-11 w-full rounded-[var(--radius-md)] border px-3 text-sm transition-colors',
      'focus-visible:outline-[2px] focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ring)]',
      invalid ? 'border-danger' : 'border-border-strong',
    );

  return (
    <StepShell
      eyebrow="Step 4"
      title="Your details"
      description="We use these to prepare your car. Nothing is verified or stored — this is a demo."
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="max-w-2xl"
      >
        {submitError ? (
          <p
            id={errorSummaryId}
            role="alert"
            className="border-danger/40 bg-danger/5 text-danger-ink mb-6 rounded-[var(--radius-md)] border px-4 py-3 text-sm"
          >
            {submitError}
          </p>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="driver-name" label="Full name" error={errors.name?.message}>
              {(describedBy, invalid) => (
                <input
                  id="driver-name"
                  type="text"
                  autoComplete="name"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  className={inputClass(invalid)}
                  {...register('name')}
                />
              )}
            </Field>
          </div>

          <Field id="driver-email" label="Email" error={errors.email?.message}>
            {(describedBy, invalid) => (
              <input
                id="driver-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className={inputClass(invalid)}
                {...register('email')}
              />
            )}
          </Field>

          <Field id="driver-phone" label="Phone" error={errors.phone?.message}>
            {(describedBy, invalid) => (
              <input
                id="driver-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                aria-invalid={invalid}
                aria-describedby={describedBy}
                className={inputClass(invalid)}
                {...register('phone')}
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field
              id="driver-licence"
              label="Driving licence number"
              hint="Format only — 5 to 20 letters and numbers. Not verified."
              error={errors.licenceNo?.message}
            >
              {(describedBy, invalid) => (
                <input
                  id="driver-licence"
                  type="text"
                  autoCapitalize="characters"
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  className={inputClass(invalid)}
                  {...register('licenceNo')}
                />
              )}
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              id="driver-notes"
              label="Notes (optional)"
              error={errors.notes?.message}
            >
              {(describedBy, invalid) => (
                <textarea
                  id="driver-notes"
                  rows={3}
                  aria-invalid={invalid}
                  aria-describedby={describedBy}
                  className={cn(
                    inputClass(invalid),
                    'h-auto resize-y py-2.5',
                  )}
                  {...register('notes')}
                />
              )}
            </Field>
          </div>
        </div>

        {/* Desktop submit — the mobile bar carries it on small widths. */}
        <div className="mt-8 hidden lg:block">
          <button
            type="submit"
            disabled={submitting}
            className="bg-accent text-accent-contrast hover:bg-accent/90 focus-visible:ring-ring inline-flex h-12 items-center rounded-md px-8 text-base font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
          >
            {submitting ? 'Confirming…' : 'Confirm reservation'}
          </button>
        </div>
      </form>
    </StepShell>
  );
}
