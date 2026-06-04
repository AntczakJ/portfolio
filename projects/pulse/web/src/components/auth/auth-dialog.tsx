'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';

import { AuthApiError, signIn, signUp } from '@/lib/api/auth';
import { invalidateOnAuthChange } from '@/lib/auth/invalidate-on-auth-change';
import {
  AUTH_SIGN_IN_DEFAULTS,
  AUTH_SIGN_UP_DEFAULTS,
  signInFormSchema,
  signUpFormSchema,
  type SignInFormValues,
  type SignUpFormValues,
} from '@/lib/schemas/auth-form';
import { useAuthPromptStore, type AuthMode } from '@/lib/store/auth-prompt-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandMark } from '@/components/chrome/brand-mark';

/**
 * The global auth dialog (Task 6.4 / 6.5) — sign in + sign up in one modal.
 *
 * Mounted once per shell; opened from anywhere via the `auth-prompt-store`
 * (`openAuthPrompt`). When a gated write affordance triggers it, the store's
 * `reason` leads with "Sign in to create your own monitors." — the tasteful
 * prompt the demo-open posture promises (ADR-007), never a raw error.
 *
 * RHF + zodResolver against the web auth-form schemas (conventions § 5). On
 * success it invalidates the session query so the header + the gated
 * affordances flip to authenticated immediately. The dashboard does NOT
 * redirect to a login wall — signed-out, it still shows the shared demo
 * workspace; this dialog is an opt-in to your OWN workspace.
 *
 * Accessibility: Radix dialog (focus trap + Escape + return-focus), every input
 * has a `<label>`, errors connect via `aria-describedby`, the server error is a
 * `role="alert"`.
 */
export function AuthDialog(): ReactNode {
  const open = useAuthPromptStore((s) => s.open);
  const mode = useAuthPromptStore((s) => s.mode);
  const reason = useAuthPromptStore((s) => s.reason);
  const setMode = useAuthPromptStore((s) => s.setMode);
  const close = useAuthPromptStore((s) => s.closeAuthPrompt);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="mb-1 flex justify-center">
            <BrandMark withWordmark={false} />
          </div>
          <DialogTitle className="text-center">
            {mode === 'sign-in' ? 'Sign in to Pulse' : 'Create your Pulse account'}
          </DialogTitle>
          <DialogDescription className="text-center">
            {reason ??
              (mode === 'sign-in'
                ? 'Sign in to manage your own monitors and alerts.'
                : 'Spin up your own workspace — monitors, incidents, alerts.')}
          </DialogDescription>
        </DialogHeader>

        {mode === 'sign-in' ? (
          <SignInForm onAuthed={close} />
        ) : (
          <SignUpForm onAuthed={close} />
        )}

        <ModeSwitch mode={mode} onSwitch={setMode} />
      </DialogContent>
    </Dialog>
  );
}

function ModeSwitch({
  mode,
  onSwitch,
}: {
  mode: AuthMode;
  onSwitch: (mode: AuthMode) => void;
}): ReactNode {
  return (
    <p className="text-center text-sm text-fg-muted">
      {mode === 'sign-in' ? (
        <>
          New to Pulse?{' '}
          <button
            type="button"
            className="font-medium text-brand underline-offset-4 hover:underline"
            onClick={() => {
              onSwitch('sign-up');
            }}
          >
            Create an account
          </button>
        </>
      ) : (
        <>
          Already have an account?{' '}
          <button
            type="button"
            className="font-medium text-brand underline-offset-4 hover:underline"
            onClick={() => {
              onSwitch('sign-in');
            }}
          >
            Sign in
          </button>
        </>
      )}
    </p>
  );
}

function SignInForm({ onAuthed }: { onAuthed: () => void }): ReactNode {
  const queryClient = useQueryClient();
  const formId = useId();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(
      signInFormSchema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as Resolver<SignInFormValues>,
    defaultValues: AUTH_SIGN_IN_DEFAULTS,
    mode: 'onBlur',
  });

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const mutation = useMutation({
    mutationFn: (values: SignInFormValues) => signIn(values),
    onSuccess: async () => {
      // Switch to the new session's workspace immediately — the board, incidents,
      // alerts, and detail data all reflect the signed-in owner with no refetch lag.
      await invalidateOnAuthChange(queryClient);
      onAuthed();
    },
  });

  const serverError = mutation.error instanceof AuthApiError
    ? mutation.error.message
    : mutation.error
      ? 'Could not sign in. Try again.'
      : null;

  const { ref: emailRef, ...emailField } = register('email');

  return (
    <form
      id={formId}
      onSubmit={handleSubmit((values) => {
        mutation.mutate(values);
      })}
      className="flex flex-col gap-4"
    >
      <Field label="Email" error={errors.email?.message} htmlFor={`${formId}-email`}>
        <Input
          id={`${formId}-email`}
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? true : undefined}
          {...emailField}
          ref={(node) => {
            emailRef(node);
            firstFieldRef.current = node;
          }}
        />
      </Field>
      <Field
        label="Password"
        error={errors.password?.message}
        htmlFor={`${formId}-password`}
      >
        <Input
          id={`${formId}-password`}
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          {...register('password')}
        />
      </Field>

      {serverError ? <ServerError message={serverError} /> : null}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <>
            <Loader2Icon className="animate-spin" />
            Signing in
          </>
        ) : (
          'Sign in'
        )}
      </Button>
    </form>
  );
}

function SignUpForm({ onAuthed }: { onAuthed: () => void }): ReactNode {
  const queryClient = useQueryClient();
  const formId = useId();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormValues>({
    resolver: zodResolver(
      signUpFormSchema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as Resolver<SignUpFormValues>,
    defaultValues: AUTH_SIGN_UP_DEFAULTS,
    mode: 'onBlur',
  });

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const mutation = useMutation({
    mutationFn: (values: SignUpFormValues) => signUp(values),
    onSuccess: async () => {
      // A fresh account starts with an EMPTY workspace; drop the demo's cached
      // monitors so the board shows "No monitors yet" immediately, not the demo's.
      await invalidateOnAuthChange(queryClient);
      onAuthed();
    },
  });

  const serverError = mutation.error instanceof AuthApiError
    ? mutation.error.message
    : mutation.error
      ? 'Could not create your account. Try again.'
      : null;

  const { ref: nameRef, ...nameField } = register('name');

  return (
    <form
      id={formId}
      onSubmit={handleSubmit((values) => {
        mutation.mutate(values);
      })}
      className="flex flex-col gap-4"
    >
      <Field label="Name" error={errors.name?.message} htmlFor={`${formId}-name`}>
        <Input
          id={`${formId}-name`}
          autoComplete="name"
          aria-invalid={errors.name ? true : undefined}
          {...nameField}
          ref={(node) => {
            nameRef(node);
            firstFieldRef.current = node;
          }}
        />
      </Field>
      <Field label="Email" error={errors.email?.message} htmlFor={`${formId}-email`}>
        <Input
          id={`${formId}-email`}
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? true : undefined}
          {...register('email')}
        />
      </Field>
      <Field
        label="Password"
        error={errors.password?.message}
        htmlFor={`${formId}-password`}
        hint="At least 8 characters."
      >
        <Input
          id={`${formId}-password`}
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.password ? true : undefined}
          {...register('password')}
        />
      </Field>

      {serverError ? <ServerError message={serverError} /> : null}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? (
          <>
            <Loader2Icon className="animate-spin" />
            Creating account
          </>
        ) : (
          'Create account'
        )}
      </Button>
    </form>
  );
}

function ServerError({ message }: { message: string }): ReactNode {
  return (
    <p
      role="alert"
      className="rounded-md border border-status-down/40 bg-status-down-surface px-3 py-2 text-sm text-status-down-text"
    >
      {message}
    </p>
  );
}

function Field({
  label,
  error,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}): ReactNode {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <div aria-describedby={errorId ?? hintId}>{children}</div>
      {error ? (
        <p id={errorId} className="text-xs text-status-down-text">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
