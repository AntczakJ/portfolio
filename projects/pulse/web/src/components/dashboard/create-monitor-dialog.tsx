'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon, PlusIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGatedAction } from '@/lib/auth/use-gated-action';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createMonitor,
  MonitorApiError,
  monitorsQueryKey,
  type MonitorRow,
} from '@/lib/api/monitors';
import { openAuthPrompt } from '@/lib/store/auth-prompt-store';
import { cn } from '@/lib/cn';
import {
  MONITOR_FORM_DEFAULTS,
  monitorFormSchema,
  toCreateMonitorInput,
  type MonitorFormOutput,
  type MonitorFormValues,
} from '@/lib/schemas/monitor-form';

/**
 * The create-monitor dialog (Task 3.5) — the second half of the wow moment:
 * add a URL, submit, and within an interval the new card appears on the
 * board and starts pulsing on real probes.
 *
 * react-hook-form + zodResolver against the web mirror of the shared create
 * schema (conventions § 5). On submit it POSTs `/monitors`; on success it
 * invalidates the monitor-list query so the new card renders immediately,
 * resets, and closes. Accessible: every input has an associated `<label>`,
 * errors connect via `aria-describedby`, focus is trapped by the Radix
 * dialog and returns to the trigger on close.
 *
 * INTERVAL note: the schema floor is 30s. The dialog offers a small interval
 * preset (30s / 60s / 5m) plus the raw seconds so a reviewer can pick a fast
 * interval and watch the card go live quickly.
 */
export function CreateMonitorDialog(): ReactNode {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const formId = useId();
  const { run } = useGatedAction();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<MonitorFormValues>({
    // @hookform/resolvers@5 brands the Zod-4 `$ZodType` against an older zod
    // minor, so the structural overload fails against zod 4.4's brand — a
    // pure type-brand mismatch, the runtime is correct (the razors-edge
    // precedent). Cast the schema through the param type the resolver
    // expects, then pin the result to the form's value type. The schema
    // still validates at runtime (conventions § 5 intact).
    resolver: zodResolver(
      monitorFormSchema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as Resolver<MonitorFormValues>,
    defaultValues: MONITOR_FORM_DEFAULTS,
    mode: 'onBlur',
  });

  const mutation = useMutation({
    // The RHF zodResolver has ALREADY validated + transformed by the time a
    // submit reaches here (e.g. `expectedKeyword: '' -> null`), so the values
    // are the schema OUTPUT — do NOT re-parse them (re-parsing the
    // already-transformed `null` keyword against the string input schema is a
    // double-validation bug). Map straight to the API body.
    mutationFn: (values: MonitorFormOutput) =>
      createMonitor(toCreateMonitorInput(values)),
    onSuccess: (created: MonitorRow) => {
      // Seed the cache optimistically so the card is on the board before the
      // refetch settles, then invalidate to reconcile the canonical list.
      queryClient.setQueryData<MonitorRow[]>(monitorsQueryKey, (prev) =>
        prev ? [created, ...prev] : [created],
      );
      void queryClient.invalidateQueries({ queryKey: monitorsQueryKey });
      reset(MONITOR_FORM_DEFAULTS);
      setOpen(false);
    },
    onError: (error) => {
      // Session expired mid-flow: route the 401 to the sign-in prompt rather
      // than the inline error (the gate normally intercepts before the POST).
      if (error instanceof MonitorApiError && error.status === 401) {
        setOpen(false);
        openAuthPrompt({
          mode: 'sign-in',
          reason: 'Sign in to create your own monitors.',
        });
      }
    },
  });

  const interval = watch('intervalSeconds');
  const serverError =
    mutation.error instanceof MonitorApiError
      ? mutation.error.message
      : mutation.error
        ? 'Something went wrong creating the monitor.'
        : null;

  // RHF types the submit values as the field (input) shape, but the resolver
  // has transformed them to the output shape at runtime — cast at this single
  // boundary so the mutation receives the validated output.
  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          mutation.reset();
        }
      }}
    >
      <Button
        type="button"
        size="sm"
        onClick={() => {
          run(() => {
            setOpen(true);
          }, 'Sign in to create your own monitors.');
        }}
      >
        <PlusIcon />
        <span className="hidden sm:inline">New monitor</span>
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New monitor</DialogTitle>
          <DialogDescription>
            Add an endpoint. Pulse starts probing it on its interval and the
            card goes live on the board.
          </DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="Name"
            error={errors.name?.message}
            htmlFor={`${formId}-name`}
          >
            <Input
              id={`${formId}-name`}
              placeholder="API gateway"
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              {...register('name')}
            />
          </Field>

          <Field
            label="Target URL"
            error={errors.targetUrl?.message}
            htmlFor={`${formId}-url`}
          >
            <Input
              id={`${formId}-url`}
              placeholder="https://example.com/health"
              inputMode="url"
              autoComplete="off"
              aria-invalid={errors.targetUrl ? true : undefined}
              {...register('targetUrl')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Interval"
              error={errors.intervalSeconds?.message}
              htmlFor={`${formId}-interval`}
            >
              <div className="flex flex-col gap-2">
                <Input
                  id={`${formId}-interval`}
                  type="number"
                  min={30}
                  max={86_400}
                  aria-invalid={errors.intervalSeconds ? true : undefined}
                  {...register('intervalSeconds')}
                />
                <div className="flex gap-1.5">
                  {INTERVAL_PRESETS.map((p) => (
                    <button
                      key={p.seconds}
                      type="button"
                      onClick={() => {
                        setValue('intervalSeconds', p.seconds, {
                          shouldValidate: true,
                        });
                      }}
                      className={cn(
                        'rounded-md border px-2 py-0.5 text-xs transition-colors',
                        interval === p.seconds
                          ? 'border-brand bg-brand-surface text-brand'
                          : 'border-border text-fg-muted hover:bg-accent',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </Field>

            <Field
              label="Timeout (ms)"
              error={errors.timeoutMs?.message}
              htmlFor={`${formId}-timeout`}
            >
              <Input
                id={`${formId}-timeout`}
                type="number"
                min={1_000}
                max={30_000}
                step={500}
                aria-invalid={errors.timeoutMs ? true : undefined}
                {...register('timeoutMs')}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Expected status"
              error={errors.expectedStatus?.message}
              htmlFor={`${formId}-status`}
            >
              <Input
                id={`${formId}-status`}
                type="number"
                min={100}
                max={599}
                aria-invalid={errors.expectedStatus ? true : undefined}
                {...register('expectedStatus')}
              />
            </Field>

            <Field
              label="Keyword (optional)"
              error={errors.expectedKeyword?.message}
              htmlFor={`${formId}-keyword`}
            >
              <Input
                id={`${formId}-keyword`}
                placeholder="ok"
                autoComplete="off"
                {...register('expectedKeyword')}
              />
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-brand)]"
              {...register('isPublic')}
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                Show on the public status page
              </span>
              <span className="text-xs text-fg-subtle">
                Public monitors expose only their status, never raw timings.
              </span>
            </span>
          </label>

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
                Creating
              </>
            ) : (
              'Create monitor'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const INTERVAL_PRESETS = [
  { label: '30s', seconds: 30 },
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
] as const;

function Field({
  label,
  error,
  htmlFor,
  children,
}: {
  label: string;
  error?: string | undefined;
  htmlFor: string;
  children: ReactNode;
}): ReactNode {
  const describedBy = error ? `${htmlFor}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      <div aria-describedby={describedBy}>{children}</div>
      {error ? (
        <p id={describedBy} className="text-xs text-status-down-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
