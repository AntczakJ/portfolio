import { z } from 'zod';

/**
 * Alert-channel schemas (Task 1.4) — the shared contract for the alerts
 * surface (ADR-005). The dispatch implementation (webhook REAL / email
 * MOCKED) is Phase 5.2; this is the wire shape only.
 */

export const alertChannelTypeSchema = z.enum(['webhook', 'email']);
export type AlertChannelType = z.infer<typeof alertChannelTypeSchema>;

/**
 * Create body. `target` is a webhook URL or an email address depending on
 * `type`; `secret` is the per-channel HMAC key for webhook signing (ADR-005),
 * nullable for email.
 */
export const createAlertChannelSchema = z
  .object({
    type: alertChannelTypeSchema,
    target: z.string().trim().min(1).max(2048),
    secret: z.string().trim().min(8).max(256).nullable().default(null),
    isEnabled: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'webhook') {
      const ok = /^https?:\/\//.test(value.target);
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['target'],
          message: 'webhook target must be an http(s) URL',
        });
      }
    } else if (!z.email().safeParse(value.target).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'email target must be a valid email address',
      });
    }
  });
export type CreateAlertChannel = z.infer<typeof createAlertChannelSchema>;

/** The read shape. `secret` is NEVER returned — it stays server-side. */
export const alertChannelResponseSchema = z.object({
  id: z.uuid(),
  type: alertChannelTypeSchema,
  target: z.string(),
  isEnabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AlertChannelResponse = z.infer<typeof alertChannelResponseSchema>;
