'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangleIcon,
  BellIcon,
  GlobeIcon,
  Loader2Icon,
  MailIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { CreateAlertChannelDialog } from './create-alert-channel-dialog';
import { WebhookSigningHint } from './webhook-signing-hint';
import { Badge } from '@/components/ui/badge';
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
  alertChannelsQueryKey,
  deleteAlertChannel,
  listAlertChannels,
} from '@/lib/api/alert-channels';
import { isAuthRequiredError } from '@/lib/auth/session-state';
import { useGatedAction } from '@/lib/auth/use-gated-action';
import { openAuthPrompt } from '@/lib/store/auth-prompt-store';
import { cn } from '@/lib/cn';
import type { AlertChannelResponse } from 'pulse-server';

/**
 * Task 5.6 — the alerts config view. Lists the configured alert channels, a
 * create dialog (webhook | email), and delete. For a webhook channel it shows
 * the signing-scheme hint (the `X-Pulse-Signature` HMAC header) so a user can
 * verify the payload. The email channel is marked honestly as a demo mock
 * ("no real email sent") — the email dispatcher records a delivery + logs the
 * message but never opens SMTP (ADR-005).
 *
 * v1 fires EVERY enabled channel on EVERY incident transition — there is no
 * per-monitor routing yet (the documented ADR-005 posture). The view says so
 * plainly rather than implying a coverage selector that does not exist.
 */
export function AlertsView(): ReactNode {
  const query = useQuery({
    queryKey: alertChannelsQueryKey,
    queryFn: listAlertChannels,
  });

  const channels = query.data;
  const hasWebhook = channels?.some((c) => c.type === 'webhook') ?? false;

  return (
    <section aria-label="Alert channels" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-xl flex-col gap-1">
          <p className="text-sm text-fg-muted">
            Pulse delivers an alert to every enabled channel when an incident
            opens and again when it resolves. Webhooks carry a signed payload;
            email is a demo mock.
          </p>
        </div>
        <CreateAlertChannelDialog />
      </div>

      {query.isPending ? <ListSkeleton /> : null}

      {query.isError ? (
        <ListError onRetry={() => void query.refetch()} />
      ) : null}

      {query.isSuccess && channels && channels.length === 0 ? (
        <EmptyState />
      ) : null}

      {query.isSuccess && channels && channels.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {channels.map((channel) => (
            <li key={channel.id}>
              <ChannelCard channel={channel} />
            </li>
          ))}
        </ul>
      ) : null}

      {hasWebhook ? <WebhookSigningHint /> : null}
    </section>
  );
}

function ChannelCard({
  channel,
}: {
  channel: AlertChannelResponse;
}): ReactNode {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isEmail = channel.type === 'email';
  const { run } = useGatedAction();

  const deleteMutation = useMutation({
    mutationFn: () => deleteAlertChannel(channel.id),
    onSuccess: () => {
      queryClient.setQueryData<AlertChannelResponse[]>(
        alertChannelsQueryKey,
        (prev) => prev?.filter((c) => c.id !== channel.id),
      );
      void queryClient.invalidateQueries({ queryKey: alertChannelsQueryKey });
      setConfirmOpen(false);
    },
    onError: (error) => {
      setConfirmOpen(false);
      if (isAuthRequiredError(error)) {
        openAuthPrompt({
          mode: 'sign-in',
          reason: 'Sign in to manage your own alert channels.',
        });
      }
    },
  });

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5">
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-4',
          isEmail
            ? 'bg-surface text-fg-muted'
            : 'bg-brand-surface text-brand',
        )}
        aria-hidden="true"
      >
        {isEmail ? <MailIcon /> : <GlobeIcon />}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground capitalize">
            {channel.type}
          </span>
          {channel.isEnabled ? (
            <Badge variant="muted" className="border-status-up/30 bg-status-up-surface text-status-up-text">
              Enabled
            </Badge>
          ) : (
            <Badge variant="muted">Disabled</Badge>
          )}
          {isEmail ? (
            <Badge
              variant="outline"
              className="border-status-degraded/40 text-status-degraded-text"
            >
              Mock — no real email sent
            </Badge>
          ) : null}
        </div>
        <span className="truncate font-mono text-xs text-fg-subtle">
          {channel.target}
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={`Delete ${channel.type} channel ${channel.target}`}
        className="shrink-0 text-fg-subtle hover:border-status-down/50 hover:bg-status-down-surface hover:text-status-down-text"
        onClick={() => {
          run(() => {
            setConfirmOpen(true);
          }, 'Sign in to manage your own alert channels.');
        }}
      >
        <Trash2Icon />
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete alert channel</DialogTitle>
            <DialogDescription>
              Pulse will stop delivering alerts to{' '}
              <span className="font-mono text-foreground">
                {channel.target}
              </span>
              . This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
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
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="h-[68px] animate-pulse rounded-lg border border-border bg-surface"
        />
      ))}
    </div>
  );
}

function ListError({ onRetry }: { onRetry: () => void }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-status-down/40 bg-status-down-surface px-6 py-12 text-center">
      <AlertTriangleIcon className="size-6 text-status-down-text" />
      <p className="text-sm font-medium text-foreground">
        Could not load alert channels
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyState(): ReactNode {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-16 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-surface">
        <BellIcon className="size-5 text-brand" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-base font-semibold text-foreground">
          No alert channels yet
        </p>
        <p className="text-sm text-fg-subtle">
          Add a webhook (Slack / Discord incoming-webhook style, signed) or an
          email channel and Pulse notifies it when an incident opens or resolves.
        </p>
      </div>
      <CreateAlertChannelDialog />
    </div>
  );
}
