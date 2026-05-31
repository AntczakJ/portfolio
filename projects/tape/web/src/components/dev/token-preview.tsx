'use client';

import type { ReactNode } from 'react';

import { THEME_TOKENS } from '@/lib/theme/tokens';
import { useThemeTokens } from '@/lib/theme/use-theme-tokens';

/* -------------------------------------------------------------------------
 * Dev-only token preview block (Task 2.5 verification aid).
 *
 * Renders every tracked theme token as a small swatch + the token's
 * current OKLCH value. Toggling the `<ThemeToggle />` cycles
 * system -> light -> dark and the swatches re-paint via the
 * `useThemeTokens` hook (which is backed by the bridge's
 * MutationObserver + `useSyncExternalStore`).
 *
 * MUST NOT ship in production. The component body short-circuits to
 * `null` when `process.env.NODE_ENV !== 'development'`; Next inlines
 * the literal at build time, the early return becomes the only
 * executed path, and Terser DCEs the rest of the function body
 * (including the `useThemeTokens` call and the JSX subtree). The
 * unused locals (`THEME_TOKENS`, `useThemeTokens`) are then dropped
 * by tree-shaking. Same strip-at-build pattern as Task 2.4's
 * `DevStatusPip`; verified post-build that the swatch JSX and the
 * `data-token-preview` attribute do not appear anywhere under
 * `.next/static`. Page-level guard at the call site is preserved as
 * defence-in-depth.
 * --------------------------------------------------------------------- */

export function TokenPreview(): ReactNode {
  if (process.env.NODE_ENV !== 'development') return null;
  return <TokenPreviewImpl />;
}

function TokenPreviewImpl(): ReactNode {
  const tokens = useThemeTokens();

  return (
    <section
      aria-label="Theme tokens (dev preview)"
      data-token-preview
      className="mt-10 grid w-full max-w-3xl gap-2 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) p-4 font-mono text-[11px]"
    >
      <header className="flex items-center justify-between text-(--color-fg-muted)">
        <span className="uppercase tracking-[0.16em]">
          Theme tokens (dev only)
        </span>
        <span className="text-(--color-fg-subtle)">
          flip theme to see swatches re-paint
        </span>
      </header>
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {THEME_TOKENS.map((token) => (
          <li
            key={token}
            className="flex items-center gap-2 rounded-(--radius-xs) border border-(--color-border) bg-(--color-bg) px-2 py-1.5"
          >
            <span
              aria-hidden="true"
              className="inline-block size-4 shrink-0 rounded-(--radius-xs) border border-(--color-border-strong)"
              style={{ background: tokens[token] }}
            />
            <span className="shrink-0 text-(--color-fg-muted)">{token}</span>
            <span
              className="ml-auto truncate text-(--color-fg-subtle)"
              data-numeric
            >
              {tokens[token]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
