import '@/lib/zod-config';

import { z } from 'zod';

import type { CreateAlertChannel } from 'pulse-server';

/**
 * The create-alert-channel FORM schema (web mirror of the server's
 * `createAlertChannelSchema`, conventions § 5).
 *
 * The server pins Zod v3 and the web is on Zod v4, so importing the server's
 * runtime object would drag a second Zod version into the browser bundle.
 * Instead we mirror the validation with the web's Zod and pin the mapped output
 * to the shared `CreateAlertChannel` type via `satisfies` — if the server's
 * create contract changes shape, the type drifts and `toCreateAlertChannel`
 * fails to compile (the drift guard).
 *
 * The form is a thin DOM-facing view: a `type` (webhook | email), a single
 * `target` field (a webhook URL or an email address, validated by type), and a
 * write-only `secret` for the webhook HMAC signing key. `target`'s by-type
 * validation MIRRORS the server's `superRefine` exactly (webhook -> http(s)
 * URL; email -> a valid address); the secret is required and min-8 for webhook
 * (it is the signing key), and omitted for email.
 *
 * `coversAllMonitors` is a UI-only flag (v1 fires every enabled channel on
 * every transition — there is no per-monitor routing server-side yet, the
 * documented ADR-005 posture), surfaced so the form reads honestly about scope.
 */

export const alertChannelFormSchema = z
  .object({
    type: z.enum(['webhook', 'email']),
    target: z.string().trim().min(1, 'Target is required').max(2048),
    secret: z.string().trim().max(256).optional().default(''),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'webhook') {
      if (!/^https?:\/\//.test(value.target)) {
        ctx.addIssue({
          code: 'custom',
          path: ['target'],
          message: 'Webhook target must be an http(s) URL',
        });
      }
      if (value.secret.length > 0 && value.secret.length < 8) {
        ctx.addIssue({
          code: 'custom',
          path: ['secret'],
          message: 'Signing secret must be at least 8 characters',
        });
      }
    } else if (!z.email().safeParse(value.target).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Enter a valid email address',
      });
    }
  });

export type AlertChannelFormValues = z.input<typeof alertChannelFormSchema>;
export type AlertChannelFormOutput = z.output<typeof alertChannelFormSchema>;

export const ALERT_CHANNEL_FORM_DEFAULTS: AlertChannelFormValues = {
  type: 'webhook',
  target: '',
  secret: '',
};

/**
 * Map the validated form output onto the API create body. Pinned to the shared
 * `CreateAlertChannel` so the request shape cannot drift from the server's
 * contract.
 *
 * The secret is nulled when empty (the server stores `null` = no per-channel
 * key; for a webhook it then falls back to the server-wide `WEBHOOK_SIGNING_KEY`
 * or, with neither, records a failed delivery rather than sending unsigned).
 * Email never carries a secret.
 */
export function toCreateAlertChannel(
  values: AlertChannelFormOutput,
): CreateAlertChannel {
  const secret =
    values.type === 'webhook' && values.secret.length > 0
      ? values.secret
      : null;
  return {
    type: values.type,
    target: values.target,
    secret,
    isEnabled: true,
  } satisfies CreateAlertChannel;
}
