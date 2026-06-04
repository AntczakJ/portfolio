'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GlobeIcon, Loader2Icon, MailIcon, PlusIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Controller, useForm, type Resolver } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useGatedAction } from '@/lib/auth/use-gated-action';
import { Label } from '@/components/ui/label';
import {
  alertChannelsQueryKey,
  createAlertChannel,
} from '@/lib/api/alert-channels';
import { MonitorApiError } from '@/lib/api/monitors';
import { openAuthPrompt } from '@/lib/store/auth-prompt-store';
import { cn } from '@/lib/cn';
import {
  ALERT_CHANNEL_FORM_DEFAULTS,
  alertChannelFormSchema,
  toCreateAlertChannel,
  type AlertChannelFormOutput,
  type AlertChannelFormValues,
} from '@/lib/schemas/alert-channel-form';
import type { AlertChannelResponse } from 'pulse-server';

/**
 * Create-alert-channel dialog (Task 5.6) — RHF + zodResolver against the web
 * mirror of the shared `createAlertChannelSchema` (conventions § 5).
 *
 * A segmented type toggle (webhook | email) swaps the target field's label /
 * placeholder / validation and shows or hides the webhook signing-secret field.
 * The secret is the per-channel HMAC key; left blank, the server falls back to
 * the deployment-wide signing key. Email is labelled honestly as a demo mock.
 *
 * v1 has no per-monitor routing — every enabled channel fires on every
 * transition — so the dialog states the coverage plainly instead of offering a
 * selector that does nothing.
 *
 * Accessible: every input has a `<label>`, errors connect via `aria-describedby`,
 * the Radix dialog traps focus and returns it to the trigger on close.
 */
export function CreateAlertChannelDialog(): ReactNode {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const formId = useId();
  const { run } = useGatedAction();

  const {
    register,
    handleSubmit,
    reset,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AlertChannelFormValues>({
    resolver: zodResolver(
      alertChannelFormSchema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as Resolver<AlertChannelFormValues>,
    defaultValues: ALERT_CHANNEL_FORM_DEFAULTS,
    mode: 'onBlur',
  });

  const type = watch('type');
  const isWebhook = type === 'webhook';

  const mutation = useMutation({
    mutationFn: (values: AlertChannelFormOutput) =>
      createAlertChannel(toCreateAlertChannel(values)),
    onSuccess: (created: AlertChannelResponse) => {
      queryClient.setQueryData<AlertChannelResponse[]>(
        alertChannelsQueryKey,
        (prev) => (prev ? [...prev, created] : [created]),
      );
      void queryClient.invalidateQueries({ queryKey: alertChannelsQueryKey });
      reset(ALERT_CHANNEL_FORM_DEFAULTS);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof MonitorApiError && error.status === 401) {
        setOpen(false);
        openAuthPrompt({
          mode: 'sign-in',
          reason: 'Sign in to add your own alert channels.',
        });
      }
    },
  });

  const serverError =
    mutation.error instanceof MonitorApiError
      ? mutation.error.message
      : mutation.error
        ? 'Something went wrong creating the channel.'
        : null;

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values as unknown as AlertChannelFormOutput);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) mutation.reset();
      }}
    >
      <Button
        type="button"
        size="sm"
        onClick={() => {
          run(() => {
            setOpen(true);
          }, 'Sign in to add your own alert channels.');
        }}
      >
        <PlusIcon />
        <span className="hidden sm:inline">Add channel</span>
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add alert channel</DialogTitle>
          <DialogDescription>
            Pulse notifies this channel when an incident opens and again when it
            resolves.
          </DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
          {/* Type segmented control. */}
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium text-foreground">
                  Channel type
                </legend>
                <div
                  role="radiogroup"
                  aria-label="Channel type"
                  className="grid grid-cols-2 gap-2"
                >
                  <TypeOption
                    selected={field.value === 'webhook'}
                    onSelect={() => {
                      field.onChange('webhook');
                    }}
                    icon={<GlobeIcon />}
                    label="Webhook"
                    sub="Signed payload"
                  />
                  <TypeOption
                    selected={field.value === 'email'}
                    onSelect={() => {
                      field.onChange('email');
                    }}
                    icon={<MailIcon />}
                    label="Email"
                    sub="Demo mock"
                  />
                </div>
              </fieldset>
            )}
          />

          <Field
            label={isWebhook ? 'Webhook URL' : 'Email address'}
            error={errors.target?.message}
            htmlFor={`${formId}-target`}
          >
            <Input
              id={`${formId}-target`}
              inputMode={isWebhook ? 'url' : 'email'}
              autoComplete="off"
              placeholder={
                isWebhook
                  ? 'https://hooks.slack.com/services/…'
                  : 'ops@example.com'
              }
              aria-invalid={errors.target ? true : undefined}
              {...register('target')}
            />
          </Field>

          {isWebhook ? (
            <Field
              label="Signing secret (optional)"
              error={errors.secret?.message}
              htmlFor={`${formId}-secret`}
              hint="The HMAC key for X-Pulse-Signature. Leave blank to use the deployment's default signing key."
            >
              <Input
                id={`${formId}-secret`}
                type="password"
                autoComplete="off"
                placeholder="at least 8 characters"
                aria-invalid={errors.secret ? true : undefined}
                {...register('secret')}
              />
            </Field>
          ) : (
            <p className="rounded-md border border-status-degraded/40 bg-status-degraded-surface px-3 py-2 text-xs text-status-degraded-text">
              Email is a demo mock — Pulse records the delivery and logs the
              rendered message, but no real email is sent (no SMTP on the demo
              host). The webhook channel is the live, real alert.
            </p>
          )}

          {/* Coverage — honest about the v1 posture (no per-monitor routing). */}
          <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5">
            <span className="mt-0.5 text-fg-subtle" aria-hidden="true">
              <GlobeIcon className="size-4" />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                Covers all monitors
              </span>
              <span className="text-xs text-fg-subtle">
                v1 fires every enabled channel on every incident. Per-monitor
                routing is a future addition.
              </span>
            </span>
          </div>

          {serverError ? (
            <p
              role="alert"
              className="rounded-md border border-status-down/40 bg-status-down-surface px-3 py-2 text-sm text-status-down-text"
            >
              {serverError}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2Icon className="animate-spin" />
                Adding
              </>
            ) : (
              'Add channel'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypeOption({
  selected,
  onSelect,
  icon,
  label,
  sub,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  sub: string;
}): ReactNode {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
        selected
          ? 'border-brand bg-brand-surface text-brand'
          : 'border-border text-fg-muted hover:bg-accent',
      )}
    >
      {icon}
      <span className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-fg-subtle">{sub}</span>
      </span>
    </button>
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
  const describedBy = error
    ? `${htmlFor}-error`
    : hint
      ? `${htmlFor}-hint`
      : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <div aria-describedby={describedBy}>{children}</div>
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-status-down-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
