'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useId, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';

import { cn } from '@/lib/cn';
import {
  contactDetailsSchema,
  type ContactDetails,
} from '@/lib/schemas/contact';

import { StepShell } from './step-shell';

interface StepDetailsProps {
  defaultValues: Partial<ContactDetails> | undefined;
  /** Persist the validated contact + advance to confirmation (submits). */
  onSubmit: (contact: ContactDetails) => void;
  submitting: boolean;
  /** A submit-time error surfaced from the server action, if any. */
  submitError: string | null;
}

/**
 * Step 4 — your details (ADR-003 / docs/conventions.md § 5).
 *
 * react-hook-form + zodResolver over the SHARED `contactDetailsSchema` (the
 * same schema the mocked submit re-validates). Inline, accessible
 * validation: every input has a `<label>`, errors are wired via
 * `aria-describedby` + `aria-invalid`, proper `type`/`autoComplete` on each
 * field, and the form announces the count of errors via `aria-live`.
 *
 * Submitting validates locally, persists the contact to the draft, and
 * fires the mocked server action (the parent shows the confirmation on
 * success).
 */
export function StepDetails({
  defaultValues,
  onSubmit,
  submitting,
  submitError,
}: StepDetailsProps): ReactNode {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitted },
  } = useForm<ContactDetails>({
    // @hookform/resolvers@5.4 types brand the Zod-4 `$ZodType` against an
    // older zod minor (`version.minor: 0`), so the structural overload match
    // fails against zod 4.4's brand (`minor: 4`) — a pure type-brand
    // mismatch, the runtime is correct. Cast the schema through the param
    // type the resolver expects, then pin the result to the form's values.
    // The shared `contactDetailsSchema` still validates at runtime — the
    // docs/conventions § 5 contract is intact.
    resolver: zodResolver(
      contactDetailsSchema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as Resolver<ContactDetails>,
    mode: 'onBlur',
    defaultValues: {
      name: defaultValues?.name ?? '',
      email: defaultValues?.email ?? '',
      phone: defaultValues?.phone ?? '',
      notes: defaultValues?.notes ?? '',
    },
  });

  const errorCount = Object.keys(errors).length;

  return (
    <StepShell
      eyebrow="Step four"
      title="Your details."
      lead="So we can hold the chair and reach you if anything changes. Nothing here is shared — this is a demo and no real appointment is made."
    >
      <form
        id="wizard-details-form"
        noValidate
        onSubmit={handleSubmit(onSubmit)}
        className="flex max-w-xl flex-col gap-6"
      >
        {/* Error summary, announced politely. */}
        <p aria-live="polite" className="sr-only">
          {isSubmitted && errorCount > 0
            ? `${String(errorCount)} ${errorCount === 1 ? 'field needs' : 'fields need'} attention.`
            : ''}
        </p>

        <Field
          label="Name"
          autoComplete="name"
          type="text"
          register={register('name')}
          error={errors.name?.message}
        />
        <Field
          label="Email"
          autoComplete="email"
          type="email"
          inputMode="email"
          register={register('email')}
          error={errors.email?.message}
        />
        <Field
          label="Phone"
          autoComplete="tel"
          type="tel"
          inputMode="tel"
          register={register('phone')}
          error={errors.phone?.message}
        />
        <Field
          label="Notes"
          optional
          type="textarea"
          register={register('notes')}
          error={errors.notes?.message}
          placeholder="Anything your barber should know — a reference photo, a preference, an allergy."
        />

        {submitError ? (
          <p role="alert" className="text-danger text-sm">
            {submitError}
          </p>
        ) : null}

        {/* On mobile the sticky bottom bar carries the Confirm CTA (D-08), so
            the inline submit is desktop-only to avoid a duplicate primary. */}
        <button
          type="submit"
          disabled={submitting}
          className="bg-primary text-primary-foreground focus-visible:ring-ring hidden h-11 items-center justify-center gap-2 self-start rounded-md px-7 text-sm font-medium transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none disabled:opacity-60 lg:inline-flex"
        >
          {submitting ? 'Confirming…' : 'Confirm booking'}
        </button>
      </form>
    </StepShell>
  );
}

interface FieldProps {
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea';
  register: ReturnType<ReturnType<typeof useForm<ContactDetails>>['register']>;
  error?: string | undefined;
  autoComplete?: string | undefined;
  inputMode?: 'email' | 'tel' | undefined;
  optional?: boolean | undefined;
  placeholder?: string | undefined;
}

function Field({
  label,
  type,
  register,
  error,
  autoComplete,
  inputMode,
  optional,
  placeholder,
}: FieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  const invalid = Boolean(error);

  // D-10: a clear resting edge + inner-surface elevation so an empty field
  // reads as a form before focus (not a flat dark-on-dark void). The inset
  // shadow lifts the field off the panel; the border-strong edge clears 3:1.
  const sharedClass = cn(
    'bg-surface/55 text-fg placeholder:text-fg-subtle/70 focus-visible:ring-ring w-full rounded-md border px-3.5 py-2.5 text-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-colors focus-visible:ring-2 focus-visible:outline-none',
    invalid
      ? 'border-danger'
      : 'border-border-strong focus-visible:border-[var(--color-edge-glow)]',
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-fg text-sm font-medium">
        {label}
        {optional ? (
          <span className="text-fg-subtle ml-2 text-xs font-normal">
            Optional
          </span>
        ) : null}
      </label>
      {type === 'textarea' ? (
        <textarea
          id={id}
          rows={3}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          placeholder={placeholder}
          className={cn(sharedClass, 'resize-y')}
          {...register}
        />
      ) : (
        <input
          id={id}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          placeholder={placeholder}
          className={sharedClass}
          {...register}
        />
      )}
      {invalid ? (
        <p id={errorId} className="text-danger text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
