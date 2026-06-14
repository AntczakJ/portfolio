'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

// Side-effect import: opt zod out of its `Function` JIT probe so the strict CSP
// (no `'unsafe-eval'`) reports zero violations on the client (see zod-config).
import '@/lib/zod-config';

interface ProvidersProps {
  children: ReactNode;
}

/**
 * Client-side providers: theme only (Task 1.2).
 *
 * A single, minimal client boundary kept as low as the app shell allows
 * (docs/conventions.md § 3) so the rest of the tree stays Server Components by
 * default. There is NO TanStack Query: nocturne has no async server data —
 * presets are static, there is no backend (ADR-001 / AGENT_NOTES #7). The
 * Zustand experience store is created at module scope (not in a provider) and
 * read directly by the chrome + the engine.
 *
 * Theme provider config (ADR-001 / ADR-004 §4, CLAUDE.md § 4):
 *   - `attribute="class"` — globals.css uses class-strategy theming: the
 *     canonical DARK chrome is `:root`, with a `.light` override for the
 *     non-canvas reading mode, plus the `@custom-variant dark` for `dark:`
 *     utilities. The canvas STAGE tokens are theme-invariant (ADR-004 §4), so
 *     the field stays a dark cinematic stage in both chrome themes.
 *   - `defaultTheme="system"` + `enableSystem` — the CHROME respects
 *     `prefers-color-scheme` on first load (CLAUDE.md § 4): a light-OS visitor
 *     gets the light reading mode, a dark-OS visitor (and the unset default,
 *     since `globals.css :root` is the dark chrome) gets dark. A hardcoded
 *     `defaultTheme="dark"` would WIN over the system probe and force dark on a
 *     light-OS visitor (D-01) — so the default must be `"system"`, not `"dark"`.
 *     NOTE (ADR-004 §4): this governs the CHROME only. The canvas STAGE tokens
 *     (`--stage-*`) are theme-INVARIANT, so the field stays a dark cinematic
 *     stage in BOTH chrome themes. `enableColorScheme` is left on (default) so
 *     `color-scheme` follows; there is no FOUC because the dark `:root` matches
 *     the suppressHydrationWarning script's first paint for the common case.
 *   - `themes={['light', 'dark']}` — exactly two named chrome themes, plus the
 *     implicit `system` resolver `enableSystem` adds.
 *   - `disableTransitionOnChange` — the theme flip is instant, not a laggy
 *     token crossfade.
 */
export function Providers({ children }: ProvidersProps): ReactNode {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      themes={['light', 'dark']}
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
