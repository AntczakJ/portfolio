'use client';

import { ShieldCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The webhook signing-scheme hint (Task 5.6). Shown when at least one webhook
 * channel exists, so a user wiring a receiver knows how to verify the payload.
 *
 * Mirrors the server's scheme exactly (ADR-005 / `webhook-payload.ts`):
 *   - header `X-Pulse-Timestamp: <unix-seconds>`
 *   - header `X-Pulse-Signature: sha256=<hex>` where
 *     hex = HMAC-SHA256(secret, "<X-Pulse-Timestamp>.<raw request body>")
 *
 * The timestamp is bound INTO the signature so a receiver can reject replays:
 * recompute over `"<timestamp>.<body>"`, constant-time compare, and reject a
 * stale timestamp. The secret is the channel's signing secret (or, if none, the
 * deployment-wide signing key).
 */
export function WebhookSigningHint(): ReactNode {
  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <ShieldCheckIcon className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-foreground">
          Verifying a webhook signature
        </h2>
      </div>
      <p className="text-sm text-fg-muted">
        Every webhook delivery is signed with HMAC-SHA256. Verify it before
        trusting the payload:
      </p>

      <dl className="flex flex-col gap-2 text-xs">
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
          <dt className="shrink-0 font-mono text-fg-subtle sm:w-44">
            X-Pulse-Timestamp
          </dt>
          <dd className="text-fg-muted">
            Unix seconds when the request was signed.
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
          <dt className="shrink-0 font-mono text-fg-subtle sm:w-44">
            X-Pulse-Signature
          </dt>
          <dd className="text-fg-muted">
            <code className="font-mono">sha256=&lt;hex&gt;</code> over the signed
            string below.
          </dd>
        </div>
      </dl>

      {/* M-3 — disable mono ligatures so the `===` in the verify line renders as
          three glyphs, not a fused ligature that misreads. */}
      <pre className="overflow-x-auto rounded-md border border-border bg-card p-3 font-mono text-xs leading-relaxed text-foreground [font-variant-ligatures:none]">
        <code className="[font-variant-ligatures:none]">{SIGNING_SNIPPET}</code>
      </pre>

      <p className="text-xs text-fg-subtle">
        Recompute the signature with your channel secret and compare in
        constant time. Reject the request if the timestamp is older than your
        tolerance (replay protection). The signing key is the channel secret, or
        the deployment-wide key when the channel has none.
      </p>
    </aside>
  );
}

const SIGNING_SNIPPET = `signed     = X-Pulse-Timestamp + "." + rawRequestBody
expected   = "sha256=" + hex(HMAC_SHA256(secret, signed))
verify(expected === X-Pulse-Signature)   // constant-time`;
