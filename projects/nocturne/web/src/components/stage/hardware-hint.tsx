'use client';

import { useState, type ReactNode } from 'react';
import { X, Zap } from 'lucide-react';

/**
 * The "enable hardware acceleration" hint (FIX 2). Shown ONLY when the capability
 * probe routed to the poster with `posterReason === 'software-webgl'` — i.e. the
 * browser is rendering WebGL in SOFTWARE (SwiftShader / llvmpipe / a major-perf-
 * caveat context), so the live GPU field would pin the CPU and we fell back to
 * the poster (see `detect-gpu-tier.ts`).
 *
 * This is a FIXABLE setting (unlike the `no-webgl2` / `no-float` floors), so the
 * note explains what is off, that the live field needs it, and how to turn it
 * on. The ordinary no-WebGL / no-JS poster gets NO hint — that is a capability
 * floor, not a misconfiguration (the Stage only mounts this for `software-webgl`).
 *
 * Accessible by construction: a real `role="status"` region (announced once,
 * politely), a real dismiss `<button>` with an aria-label, brand visible focus
 * (the global focus-visible ring), AA-contrast over-stage ink (theme-invariant
 * `--hud-ink`, so it stays legible on the always-dark stage in light chrome
 * too). Positioned `fixed` so dismissing it causes NO layout shift to the poster
 * / directory beneath it. CSS-only transitions (ADR-001 single-family posture).
 */
export function HardwareHint(): ReactNode {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        role="status"
        aria-live="polite"
        className="hud-scrim-strong pointer-events-auto flex w-full max-w-[min(94vw,34rem)] items-start gap-3 rounded-[var(--radius-lg)] px-4 py-3.5 text-[var(--hud-ink)] shadow-lg backdrop-blur-sm"
      >
        <Zap
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-[var(--color-accent)]"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1 text-sm leading-relaxed">
          <p className="font-medium text-[var(--hud-ink)]">
            Hardware-accelerated WebGL appears to be off
          </p>
          <p className="mt-1 text-[var(--hud-ink-muted)]">
            The live GPU particle field needs it, so this is the poster instead.
            Enable hardware acceleration in your browser settings (or check{' '}
            <span className="font-[family-name:var(--font-display)] tracking-tight text-[var(--hud-ink)]">
              chrome://gpu
            </span>
            ), then reload.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
          }}
          aria-label="Dismiss hardware acceleration note"
          className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--hud-ink-muted)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--hud-ink)] focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ outlineColor: 'var(--color-accent)' }}
        >
          <X aria-hidden className="size-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
