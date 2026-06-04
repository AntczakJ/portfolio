'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLinkIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { EditMonitorDialog } from './edit-monitor-dialog';
import { ActiveIncidentBanner } from './active-incident-banner';
import { StatusDot } from '@/components/dashboard/status-dot';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteMonitor,
  monitorsQueryKey,
  updateMonitor,
  type MonitorRow,
} from '@/lib/api/monitors';
import { isAuthRequiredError } from '@/lib/auth/session-state';
import { useGatedAction } from '@/lib/auth/use-gated-action';
import { openAuthPrompt } from '@/lib/store/auth-prompt-store';
import { cn } from '@/lib/cn';
import { useLiveBoard } from '@/lib/store/live-store';
import { type DisplayStatus } from '@/lib/status/status-tokens';

interface DetailHeaderProps {
  monitor: MonitorRow;
}

/**
 * The monitor-detail header — name, target URL, the live status dot + label,
 * interval, and the action cluster (edit / pause / delete).
 *
 * The status dot reads LIVE from the same SSE store the board uses: a
 * `status.change` for this monitor flips the header in real time, and the
 * latest `check.result` response time renders beside it. Falls back to the
 * REST snapshot's `currentStatus` until the first live result.
 *
 * Actions wire to the existing CRUD: edit -> PATCH (dialog), pause/resume ->
 * PATCH `isPaused` (a real backend field — not a stub), delete -> DELETE then
 * navigate back to the board.
 */
export function DetailHeader({ monitor }: DetailHeaderProps): ReactNode {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { run } = useGatedAction();

  // The server-side 401 fallback (ADR-007): a write that slips past the client
  // gate (e.g. the session expired mid-session) returns `authentication_required`
  // — route it to the sign-in prompt instead of a raw error.
  const onMutationError = (error: unknown, reason: string): void => {
    if (isAuthRequiredError(error)) {
      openAuthPrompt({ mode: 'sign-in', reason });
    }
  };

  const live = useLiveBoard((s) => s.monitors[monitor.id]);
  const status = resolveStatus(monitor, live?.status, live?.lastCheckedAt ?? null);
  const responseTime = live?.lastResponseTimeMs ?? null;
  const host = safeHost(monitor.targetUrl);

  const pauseMutation = useMutation({
    mutationFn: (next: boolean) =>
      updateMonitor(monitor.id, { isPaused: next }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['monitor', monitor.id], updated);
      queryClient.setQueryData<MonitorRow[]>(monitorsQueryKey, (prev) =>
        prev?.map((m) => (m.id === updated.id ? updated : m)),
      );
      void queryClient.invalidateQueries({ queryKey: ['monitor', monitor.id] });
      void queryClient.invalidateQueries({ queryKey: monitorsQueryKey });
    },
    onError: (error) => {
      onMutationError(error, 'Sign in to manage your own monitors.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMonitor(monitor.id),
    onSuccess: () => {
      queryClient.setQueryData<MonitorRow[]>(monitorsQueryKey, (prev) =>
        prev?.filter((m) => m.id !== monitor.id),
      );
      void queryClient.invalidateQueries({ queryKey: monitorsQueryKey });
      router.push('/dashboard');
    },
    onError: (error) => {
      setDeleteOpen(false);
      onMutationError(error, 'Sign in to manage your own monitors.');
    },
  });

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-xl font-semibold text-foreground sm:text-2xl">
              {monitor.name}
            </h1>
            <StatusDot status={status} withLabel />
            {monitor.isPaused ? (
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-fg-muted">
                Paused
              </span>
            ) : null}
          </div>
          <a
            href={monitor.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 font-mono text-sm text-fg-muted transition-colors hover:text-foreground"
          >
            {host}
            <ExternalLinkIcon className="size-3.5 shrink-0" />
          </a>
          <div className="flex items-center gap-3 text-xs text-fg-subtle">
            <span>{formatInterval(monitor.intervalSeconds)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{monitor.method}</span>
            {responseTime != null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {String(responseTime)}ms last
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              run(() => {
                setEditOpen(true);
              }, 'Sign in to edit your own monitors.');
            }}
          >
            <PencilIcon />
            <span className="hidden sm:inline">Edit</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pauseMutation.isPending}
            onClick={() => {
              run(() => {
                pauseMutation.mutate(!monitor.isPaused);
              }, 'Sign in to pause your own monitors.');
            }}
          >
            {pauseMutation.isPending ? (
              <Loader2Icon className="animate-spin" />
            ) : monitor.isPaused ? (
              <PlayIcon />
            ) : (
              <PauseIcon />
            )}
            <span className="hidden sm:inline">
              {monitor.isPaused ? 'Resume' : 'Pause'}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              'text-status-down-text hover:border-status-down/50 hover:bg-status-down-surface',
            )}
            onClick={() => {
              run(() => {
                setDeleteOpen(true);
              }, 'Sign in to delete your own monitors.');
            }}
          >
            <Trash2Icon />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      </div>

      {/* Active-incident banner — appears when this monitor has an open incident
          (live from the SSE store), counting its duration up. */}
      <ActiveIncidentBanner monitorId={monitor.id} />

      <EditMonitorDialog
        monitor={monitor}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete monitor</DialogTitle>
            <DialogDescription>
              This permanently removes{' '}
              <span className="font-medium text-foreground">{monitor.name}</span>{' '}
              and stops probing it. Its check history is deleted. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  Deleting
                </>
              ) : (
                'Delete monitor'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}

function resolveStatus(
  monitor: MonitorRow,
  liveStatus: DisplayStatus | undefined,
  liveCheckedAt: number | null,
): DisplayStatus {
  if (liveStatus && liveCheckedAt != null) {
    return liveStatus;
  }
  if (
    monitor.currentStatus === 'up' ||
    monitor.currentStatus === 'degraded' ||
    monitor.currentStatus === 'down'
  ) {
    return monitor.currentStatus;
  }
  return 'unknown';
}

function formatInterval(seconds: number): string {
  if (seconds >= 3600) return `Every ${String(Math.round(seconds / 3600))}h`;
  if (seconds >= 60) return `Every ${String(Math.round(seconds / 60))}m`;
  return `Every ${String(seconds)}s`;
}

function safeHost(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return rawUrl;
  }
}
