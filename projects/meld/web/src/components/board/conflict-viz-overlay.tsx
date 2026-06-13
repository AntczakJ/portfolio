'use client';

import { useEffect, useState } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';

import { useUiStore } from '@/lib/stores/ui-store';

/**
 * Dev-only conflict-viz overlay (Phase 2.6 / ADR-008).
 *
 * The entire module body is gated by `process.env.NODE_ENV ===
 * 'development'`. Next.js's Webpack `DefinePlugin` inlines the env
 * literal as `"production"` in the production build, Terser then
 * dead-code-eliminates the always-false branch and the module body
 * becomes unreachable. The build-time audit step is documented in
 * AGENT_NOTES — `pnpm -F meld-web build && grep -r '[meld-dev-
 * conflict-viz]' web/.next/static/chunks` MUST return zero matches.
 *
 * Strip-mechanism notes:
 *
 *   1. The component is split into a tiny exported `ConflictVizOverlay`
 *      guard + a `ConflictVizOverlayImpl` body so the guard contains
 *      the literal `process.env.NODE_ENV !== 'development'` check
 *      that Terser folds, AND the impl is only referenced from the
 *      gated branch. The eslint `react-hooks/rules-of-hooks` rule
 *      forbids hooks below a conditional return, so hooks live in
 *      the Impl which is reached only on the dev branch.
 *
 *   2. The host component (`<BoardCanvasHost />`) ALSO gates the JSX
 *      render site behind the same env literal — belt-and-braces.
 *      Production build sees the JSX site fold to `false && ...`,
 *      Terser DCEs it, and the unused `ConflictVizOverlay` import
 *      becomes tree-shakable.
 *
 *   3. All log + UI strings carry the `[meld-dev-conflict-viz]`
 *      literal so the grep audit catches a regression that ships
 *      the module to production by accident.
 *
 * Surface (Phase 2.6 — minimum viable):
 *
 *   - Current `Y.Doc` client id.
 *   - Connection status mirror via the awareness summary.
 *   - Awareness summary: count of remote states + their session ids
 *     (truncated to 8 chars).
 *
 * Phase 3.x will surface the engine paint-cost metrics
 * (`paintCount`, `avgPaintMs`, `p99PaintMs`, `framesSkipped`) inside
 * this panel so dev sessions can correlate visual jank with the
 * engine telemetry counter without leaving the page.
 */

const KEY_TOGGLE_LITERAL = '[meld-dev-conflict-viz] toggle';

export interface ConflictVizOverlayProps {
  provider: HocuspocusProvider;
}

export function ConflictVizOverlay(
  props: ConflictVizOverlayProps,
): React.ReactNode {
  if (process.env.NODE_ENV !== 'development') return null;
  return <ConflictVizOverlayImpl {...props} />;
}

function ConflictVizOverlayImpl({
  provider,
}: ConflictVizOverlayProps): React.ReactNode {
  const showConflictViz = useUiStore((state) => state.showConflictViz);
  const toggleConflictViz = useUiStore((state) => state.toggleConflictViz);

  // Keyboard shortcut handler. Cmd+Shift+D on macOS, Ctrl+Shift+D
  // elsewhere — both bound here so the same physical chord works
  // across platforms.
  useEffect(() => {
    function onKeydown(event: KeyboardEvent): void {
      if (event.shiftKey && (event.metaKey || event.ctrlKey)) {
        // event.key is layout-aware; check both the keycap label AND
        // `event.code === 'KeyD'` so non-Latin layouts still hit the
        // shortcut.
        if (event.key === 'D' || event.key === 'd' || event.code === 'KeyD') {
          event.preventDefault();
          toggleConflictViz();
          // The literal below is grep-audited at build time.
          console.log(KEY_TOGGLE_LITERAL);
        }
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
    };
  }, [toggleConflictViz]);

  // Live awareness summary — re-rendered on awareness change. The
  // overlay is dev-only and the awareness set is small (5-10 peers
  // typical for a demo), so per-event re-render is fine.
  const [awarenessSummary, setAwarenessSummary] = useState<
    readonly { clientId: number; sessionId: string | null }[]
  >([]);

  useEffect(() => {
    const awareness = provider.awareness;
    if (awareness === null) return;
    function refresh(): void {
      if (awareness === null) return;
      const states = awareness.getStates();
      const next: { clientId: number; sessionId: string | null }[] = [];
      states.forEach((state, clientId) => {
        const raw = (state as { sessionId?: unknown }).sessionId;
        next.push({
          clientId,
          sessionId: typeof raw === 'string' ? raw : null,
        });
      });
      setAwarenessSummary(next);
    }
    refresh();
    awareness.on('change', refresh);
    return () => {
      awareness.off('change', refresh);
    };
  }, [provider]);

  if (!showConflictViz) return null;

  return (
    <div
      // The literal `[meld-dev-conflict-viz]` appears in the visible
      // panel header below so the production-bundle grep audit
      // catches any accidental ship.
      role="region"
      aria-label="[meld-dev-conflict-viz] development panel"
      className="pointer-events-none fixed bottom-4 right-4 z-50 w-72 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface) p-3 font-mono text-[10px] leading-tight text-(--color-fg) shadow-sm"
    >
      <header className="mb-2 flex items-center justify-between border-b border-(--color-border) pb-1">
        <span className="text-(--color-fg-subtle)">
          [meld-dev-conflict-viz]
        </span>
        <span className="text-(--color-fg-muted)">
          Cmd/Ctrl + Shift + D
        </span>
      </header>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
        <dt className="text-(--color-fg-subtle)">clientId</dt>
        <dd>{provider.document.clientID}</dd>
        <dt className="text-(--color-fg-subtle)">peers</dt>
        <dd>{awarenessSummary.length}</dd>
      </dl>
      {awarenessSummary.length > 0 && (
        <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
          {awarenessSummary.map((peer) => (
            <li
              key={peer.clientId}
              className="flex justify-between gap-2 text-(--color-fg-muted)"
            >
              <span>#{peer.clientId}</span>
              <span>
                {peer.sessionId !== null
                  ? `${peer.sessionId.slice(0, 8)}…`
                  : 'n/a'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-(--color-fg-subtle)">
        [meld-dev-conflict-viz] stripped in production.
      </p>
    </div>
  );
}
