'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useId, type ReactNode } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MonitorApiError,
  monitorsQueryKey,
  updateMonitor,
  type MonitorRow,
} from '@/lib/api/monitors';
import { monitorDetailKeys } from '@/lib/api/monitor-detail';
import {
  monitorFormSchema,
  type MonitorFormOutput,
  type MonitorFormValues,
} from '@/lib/schemas/monitor-form';
import type { UpdateMonitor } from 'pulse-server';

interface EditMonitorDialogProps {
  monitor: MonitorRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The edit-monitor dialog — pre-filled from the monitor row, PATCHes
 * `/monitors/:id` (the existing CRUD). On success it invalidates the monitor
 * list AND this monitor's detail query so the header / charts re-read.
 *
 * Reuses the shared `monitorFormSchema` (conventions § 5) — the same fields as
 * create, minus the create-only `isPublic` toggle wording. Editing the interval
 * re-registers the BullMQ repeatable server-side (ADR-002 reconcile), no client
 * concern.
 */
export function EditMonitorDialog({
  monitor,
  open,
  onOpenChange,
}: EditMonitorDialogProps): ReactNode {
  const queryClient = useQueryClient();
  const formId = useId();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<MonitorFormValues>({
    resolver: zodResolver(
      monitorFormSchema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as Resolver<MonitorFormValues>,
    defaultValues: toFormValues(monitor),
    mode: 'onBlur',
  });

  // Re-seed the form when the dialog opens (the monitor may have changed live).
  useEffect(() => {
    if (open) {
      reset(toFormValues(monitor));
    }
  }, [open, monitor, reset]);

  const mutation = useMutation({
    mutationFn: (values: MonitorFormOutput) =>
      updateMonitor(monitor.id, toUpdateInput(values)),
    onSuccess: (updated) => {
      queryClient.setQueryData<MonitorRow[]>(monitorsQueryKey, (prev) =>
        prev?.map((m) => (m.id === updated.id ? updated : m)),
      );
      queryClient.setQueryData(monitorDetailKeys.monitor(monitor.id), updated);
      void queryClient.invalidateQueries({
        queryKey: monitorDetailKeys.monitor(monitor.id),
      });
      void queryClient.invalidateQueries({ queryKey: monitorsQueryKey });
      onOpenChange(false);
    },
  });

  const serverError =
    mutation.error instanceof MonitorApiError
      ? mutation.error.message
      : mutation.error
        ? 'Something went wrong saving the monitor.'
        : null;

  const onSubmit = handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) mutation.reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit monitor</DialogTitle>
          <DialogDescription>
            Changes apply on the next probe. Editing the interval re-schedules
            the check.
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
              inputMode="url"
              aria-invalid={errors.targetUrl ? true : undefined}
              {...register('targetUrl')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Interval (s)"
              error={errors.intervalSeconds?.message}
              htmlFor={`${formId}-interval`}
            >
              <Input
                id={`${formId}-interval`}
                type="number"
                min={30}
                max={86_400}
                aria-invalid={errors.intervalSeconds ? true : undefined}
                {...register('intervalSeconds')}
              />
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
              label="Keyword"
              error={errors.expectedKeyword?.message}
              htmlFor={`${formId}-keyword`}
            >
              <Input
                id={`${formId}-keyword`}
                placeholder="optional"
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
            <span className="text-sm font-medium text-foreground">
              Show on the public status page
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
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2Icon className="animate-spin" />
                Saving
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toFormValues(monitor: MonitorRow): MonitorFormValues {
  return {
    name: monitor.name,
    targetUrl: monitor.targetUrl,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    expectedStatus: monitor.expectedStatus,
    expectedKeyword: monitor.expectedKeyword ?? '',
    isPublic: monitor.isPublic,
  };
}

function toUpdateInput(values: MonitorFormOutput): UpdateMonitor {
  return {
    name: values.name,
    targetUrl: values.targetUrl,
    intervalSeconds: values.intervalSeconds,
    timeoutMs: values.timeoutMs,
    expectedStatus: values.expectedStatus,
    expectedKeyword: values.expectedKeyword,
    isPublic: values.isPublic,
  } satisfies UpdateMonitor;
}

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
