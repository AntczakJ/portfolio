'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import { motion, useReducedMotion } from 'motion/react';
import * as Y from 'yjs';

import {
  createBoardProvider,
  requireAwareness,
} from '@/lib/yjs/provider';
import { AwarenessProvider } from '@/lib/yjs/awareness-context';
import { useConnectionStatus } from '@/lib/yjs/use-connection-status';
import { useReconciliationCount } from '@/lib/yjs/use-reconciliation-count';
import { BoardEngine } from '@/lib/canvas/engine';
import { getThemeTokensBridge } from '@/lib/canvas/theme-tokens';
import { useUiStore } from '@/lib/stores/ui-store';
import { useWelcomeStore } from '@/lib/stores/welcome-store';
import { ConnectionBanner } from '@/components/chrome/connection-banner';
import { OfflineAriaLiveRegion } from '@/components/chrome/offline-aria-live-region';

import { BoardPointerOverlay } from './board-pointer-overlay';
import { BoardToolbar } from './board-toolbar';

/**
 * `<BoardCanvasHost />` — the React shell for the Phase 2.6 canvas
 * surface (replaces Task 2.4's `<BoardCanvasPlaceholder />`).
 *
 * Responsibilities:
 *
 *   1. Mount two stacked `<canvas>` elements inside the route's
 *      `<main>` region — a `data-meld-layer="shapes"` canvas at the
 *      bottom, a `data-meld-layer="cursors"` canvas on top with
 *      `pointer-events: none` so the shape canvas keeps hit-testing.
 *      Both fill the available region.
 *
 *   2. Construct the `HocuspocusProvider` once per board mount,
 *      construct the `BoardEngine` against the provider's `document`
 *      + `awareness`, call `engine.start()`. Tear down in reverse
 *      order on unmount.
 *
 *   3. Sync canvas backing-store dimensions to the CSS region via a
 *      `ResizeObserver` and the host's `devicePixelRatio`. The
 *      engine's `handleResize(cssW, cssH, dpr)` does the actual
 *      `canvas.width = cssW * dpr` work; the host just feeds it
 *      live dimensions.
 *
 *   4. Render the dev-only conflict-viz overlay (Cmd/Ctrl + Shift +
 *      D) — the JSX site is gated by `process.env.NODE_ENV ===
 *      'development'` so the production bundle never sees the
 *      `ConflictVizOverlay` import. Terser DCEs the import + the
 *      JSX element. Audit step: `grep -r '[meld-dev-conflict-viz]'
 *      web/.next/static/chunks` returns ZERO matches.
 *
 *   5. Render the board's name + truncated id as an overlay caption
 *      in the top-left, with `pointer-events: none` so the canvas
 *      keeps focus.
 *
 * The component does NOT trigger paint via re-render — the engine
 * lives outside React's reconciler. Per ADR-008, the only React
 * state on this component is the canvas refs + a `provider` state
 * trigger for the dev overlay (set once after construction so the
 * overlay can hold a typed reference); the engine's paint loop is a
 * `requestAnimationFrame` driven by the Yjs observer + awareness
 * change events, not by React.
 */

// Conditional require — the import path is gated by the literal
// folding Next + Webpack apply to `process.env.NODE_ENV`. In a
// production build the right-hand side never evaluates; Terser
// removes the require call AND the imported module from the dep
// graph. The audit step is documented in AGENT_NOTES.
//
// We can't use the `require` form with `verbatimModuleSyntax: true`
// because Next/Webpack still resolves the literal string at compile
// time. The cleaner pattern is the JSX-level gate at the render
// site below — the import is a `import type` for the props type
// only, and the value comes through a separate `dynamic`-style
// branch.
//
// Implementation: we use `next/dynamic` here would emit the chunk
// into production (per ADR-008's D3 rejection). Instead we keep a
// plain top-level `import` of the overlay AND gate the JSX site;
// Next/Webpack constant-folds the conditional `if (process.env.
// NODE_ENV === 'development')` and Terser DCEs the unreachable
// branch INCLUDING the JSX element AND its imported component
// reference. The overlay's module body itself ALSO opens with the
// same gate so any path that escapes the JSX strip short-circuits
// to `return null`. Belt + braces.
import { ConflictVizOverlay } from './conflict-viz-overlay';

interface BoardCanvasHostProps {
  boardId: string;
  boardName: string;
  /** Server-supplied ms epoch for the board's creation. */
  createdAt: number;
  /** Server-snapshot count — overlay only shows it until the welcome frame lands. */
  connectedClients: number;
}

export function BoardCanvasHost({
  boardId,
  boardName,
  createdAt,
  connectedClients,
}: BoardCanvasHostProps): ReactNode {
  const shapeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The provider + engine live in refs because they are constructed
  // imperatively and held across renders. Storing them in state
  // would force a re-render on the first commit pass.
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const engineRef = useRef<BoardEngine | null>(null);

  // Dev-only: a state slot that holds the live provider for the
  // overlay to read. In production the overlay JSX site is
  // unreachable so the state never reads; the cost is one
  // `useState` call (effectively zero).
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  // Live Y.Doc — surfaced to React state so the pointer overlay can
  // read it after construction. The doc is owned by the provider
  // (destroyed when the provider is destroyed); this state slot is
  // a non-owning reference for the JSX consumer.
  const [doc, setDoc] = useState<Y.Doc | null>(null);

  useEffect(() => {
    const shapeCanvas = shapeCanvasRef.current;
    const cursorCanvas = cursorCanvasRef.current;
    const container = containerRef.current;
    if (
      shapeCanvas === null ||
      cursorCanvas === null ||
      container === null
    ) {
      return;
    }

    // 1. Build the Y.Doc + provider. The provider owns the Y.Doc
    // lifecycle: when `provider.destroy()` runs on unmount, the doc
    // is also torn down. We construct the doc here and hand it to
    // the factory so the engine can hold the same reference.
    const localDoc = new Y.Doc();
    const hocuspocusProvider = createBoardProvider(boardId, { doc: localDoc });
    providerRef.current = hocuspocusProvider;
    setProvider(hocuspocusProvider);
    setDoc(localDoc);

    // 2. Build the engine + start. `requireAwareness` narrows the
    // `Awareness | null` to non-null — meld v1 always opts in. The
    // engine derives each remote peer's awareness color slot from
    // `(sessionId, boardId)` per ADR-005's per-board collision-
    // avoidance rule.
    const themeBridge = getThemeTokensBridge();
    const engine = new BoardEngine({
      shapeCanvas,
      cursorCanvas,
      doc: localDoc,
      awareness: requireAwareness(hocuspocusProvider),
      boardId,
      themeBridge,
    });
    engineRef.current = engine;
    engine.start();

    // 2a. Phase 3.3 — keep the engine's local-session-id seam in sync
    // with the welcome store. The engine excludes the matching session
    // id from the cursor render map BEFORE the painter sees it so the
    // OS pointer is the only thing drawing the local cursor. Case A
    // (welcome already in the store at mount) seeds immediately; Case
    // B (welcome lands over the wire after mount) seeds on the next
    // store transition.
    const initialWelcome = useWelcomeStore.getState().welcome;
    if (initialWelcome !== null) {
      engine.setLocalSessionId(initialWelcome.session.id);
    }
    const unsubscribeWelcome = useWelcomeStore.subscribe((state) => {
      engine.setLocalSessionId(state.welcome?.session.id ?? null);
    });

    // 3. Wire the ResizeObserver. We feed CSS pixels + DPR; the
    // engine does the backing-store sync.
    const handleResize = (): void => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      engine.handleResize(rect.width, rect.height, dpr);
    };
    handleResize();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    // DPR can change without a resize (the user dragging the
    // window between two monitors with different scaling). The
    // matchMedia change event is the documented hook.
    const dprMedia = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    const onDprChange = (): void => {
      handleResize();
    };
    dprMedia.addEventListener('change', onDprChange);

    return () => {
      resizeObserver.disconnect();
      dprMedia.removeEventListener('change', onDprChange);
      unsubscribeWelcome();
      // Stop the engine BEFORE destroying the provider so the
      // engine's shape-map observer detaches before the document is
      // torn down (avoids a benign "unobserving an already-destroyed
      // map" warning).
      engine.stop();
      engineRef.current = null;
      hocuspocusProvider.destroy();
      providerRef.current = null;
      setProvider(null);
      setDoc(null);
    };
  }, [boardId]);

  // Wrap the canvas region in `<AwarenessProvider>` so Phase 3.3's
  // `<PresenceCursors />` can subscribe to the remote-peer list via
  // `useAwarenessContext()` without re-attaching its own `'change'`
  // listener on the `Awareness` instance. The provider takes the live
  // `Awareness | null` from the active Hocuspocus provider; the hook
  // handles `null` (returns empty snapshot) so the wrap is safe
  // through the construction window.
  const awareness = provider === null ? null : provider.awareness;

  // -----------------------------------------------------------------
  // Phase 3.4 / ADR-009 — offline-mode UX orchestrator.
  //
  //   - `useConnectionStatus(provider)` resolves the canonical
  //     ConnectionState per ADR-009's rule (debounced disconnect +
  //     navigator.onLine short-circuit).
  //   - `useReconciliationCount({ doc, connectionState })` tracks the
  //     shape-count delta across the offline window so the aria-live
  //     copy variant + the crossfade gate both have a value.
  //   - The store mirror exists so non-React readers (the banner +
  //     the aria-live region) subscribe once and re-render on
  //     transitions without redundant fan-out from this host.
  //
  // The chain runs THROUGH the store rather than passing props down
  // because both `<ConnectionBanner />` and `<OfflineAriaLiveRegion />`
  // are chrome-level components a future agent may relocate up into
  // `<TopBar />` (or down into a per-board panel) without re-threading
  // props.
  // -----------------------------------------------------------------
  const connectionState = useConnectionStatus(provider);
  const incomingShapeCount = useReconciliationCount({
    doc,
    connectionState,
  });
  const setConnectionState = useUiStore((s) => s.setConnectionState);
  const recordReconcile = useUiStore((s) => s.recordReconcile);

  // Sync the resolved connection state into the ui store. Selector
  // mirroring means the banner + aria-live region subscribe to the
  // store directly and stay decoupled from this host's render path.
  useEffect(() => {
    setConnectionState(connectionState);
  }, [connectionState, setConnectionState]);

  // Sync the reconcile delta. The hook resets to `0` outside offline
  // windows and refreshes on `offline → live`; we mirror it 1:1.
  useEffect(() => {
    recordReconcile(incomingShapeCount);
  }, [incomingShapeCount, recordReconcile]);

  // -----------------------------------------------------------------
  // Shape-canvas crossfade gate (ADR-009 R3).
  //
  // Per the ADR: on `offline → live` with `incomingShapeCount > 0`,
  // the SHAPE canvas dips to opacity 0.6 over 100 ms and returns to
  // 1.0 over 100 ms — a 200 ms total `easeInOutCubic` curve. The
  // CURSOR canvas is excluded (ADR-008's existing critical-damped
  // lerp absorbs the cursor catch-up at zero new code). The pointer
  // overlay, conflict-viz, toolbar, and caption are also excluded
  // because the crossfade is communicating "shape state changed",
  // not "everything refreshed".
  //
  // Reduced-motion: skip the crossfade entirely (opacity stays 1.0).
  // -----------------------------------------------------------------
  const reduceMotion = useReducedMotion();
  const previousConnectionRef = useRef<typeof connectionState>(connectionState);
  const [shapeOpacity, setShapeOpacity] = useState<number>(1);

  useEffect(() => {
    const previous = previousConnectionRef.current;
    previousConnectionRef.current = connectionState;
    if (previous === connectionState) return;
    if (previous !== 'offline' || connectionState !== 'live') return;
    if (incomingShapeCount <= 0) return;
    if (reduceMotion === true) return;

    // Drive the dip → return via two scheduled state writes; Motion's
    // `transition` on the wrapper applies the same easing to both
    // legs. The first write triggers a 100 ms ease down; the second
    // restores after 100 ms. Total perceived duration ~200 ms.
    setShapeOpacity(0.6);
    const handle = setTimeout(() => {
      setShapeOpacity(1);
    }, 100);
    return () => {
      clearTimeout(handle);
    };
  }, [connectionState, incomingShapeCount, reduceMotion]);

  const shapeTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.1, ease: [0.65, 0, 0.35, 1] as const };

  return (
    <AwarenessProvider awareness={awareness}>
      <main
        id="main"
        tabIndex={-1}
        className="relative flex flex-1 flex-col"
      >
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-(--color-bg)"
        >
          {/*
           * Shape canvas wrapped in a motion.div so the Phase 3.4 /
           * ADR-009 reconcile crossfade hits only the shapes. The
           * cursor canvas + pointer overlay + chrome stay at full
           * opacity throughout — cursor catch-up is the engine's
           * existing critical-damped lerp (zero new code).
           */}
          <motion.div
            className="absolute inset-0"
            animate={{ opacity: shapeOpacity }}
            transition={shapeTransition}
          >
            <canvas
              ref={shapeCanvasRef}
              data-meld-layer="shapes"
              data-testid="shape-canvas"
              className="absolute inset-0 h-full w-full"
              // Accessible label — the canvas itself is not focusable
              // in v1 (Phase 3.2 adds the parallel hidden-DOM
              // `<button>` shape-proxy tree for keyboard nav). The
              // role + label give a screen reader something better
              // than "graphic" on first arrival.
              role="img"
              aria-label={`Drawing board: ${boardName}`}
            />
          </motion.div>
          <canvas
            ref={cursorCanvasRef}
            data-meld-layer="cursors"
            data-testid="cursor-canvas"
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden="true"
          />
          {/*
           * Pointer overlay sits ABOVE the cursor canvas (z-stacked
           * by DOM order) and captures pointer events for drawing.
           * Mounted only after the Y.Doc exists so the first mount
           * does not race a `null` doc check inside the overlay's
           * pointerdown handler.
           */}
          {doc !== null ? (
            <BoardPointerOverlay
              doc={doc}
              boardId={boardId}
              awareness={awareness}
            />
          ) : null}
          <BoardCaption
            boardName={boardName}
            boardId={boardId}
            createdAt={createdAt}
            connectedClients={connectedClients}
          />
          <BoardToolbar />
          {/*
           * Phase 3.4 / ADR-009 — offline banner pinned to the top of
           * the canvas region (NOT the top bar) so the visual locality
           * is right next to the canvas it's annotating. The banner's
           * own `AnimatePresence` handles the slide-in / slide-out.
           */}
          <ConnectionBanner />
          {/*
           * Phase 3.4 / ADR-009 — assertive sr-only aria-live region.
           * Mounted in the host (not the layout) so it tears down on
           * board navigation; per-route announcement is what we want.
           */}
          <OfflineAriaLiveRegion />
          {process.env.NODE_ENV === 'development' && provider !== null && (
            <ConflictVizOverlay provider={provider} />
          )}
        </div>
      </main>
    </AwarenessProvider>
  );
}

/**
 * Tiny top-left caption mirroring the placeholder's info readout.
 * `pointer-events: none` so it never intercepts the canvas; muted
 * styling so it does not compete with shapes once Phase 3.2 lands.
 */
function BoardCaption({
  boardName,
  boardId,
  createdAt,
  connectedClients,
}: {
  boardName: string;
  boardId: string;
  createdAt: number;
  connectedClients: number;
}): ReactNode {
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-10 flex max-w-xs flex-col gap-1 rounded-(--radius-md) border border-(--color-border) bg-(--color-surface)/90 px-3 py-2 text-xs backdrop-blur-sm">
      <p
        className="text-sm font-medium text-(--color-fg)"
        title={boardName}
      >
        {boardName}
      </p>
      <p className="font-mono text-[10px] text-(--color-fg-subtle)">
        {formatBoardId(boardId)} · {formatCreatedAt(createdAt)} ·{' '}
        {connectedClients.toString()} connected
      </p>
    </div>
  );
}

function formatBoardId(boardId: string): string {
  if (boardId.length <= 16) return boardId;
  return `${boardId.slice(0, 8)}…${boardId.slice(-4)}`;
}

function formatCreatedAt(createdAt: number): string {
  const created = new Date(createdAt);
  const now = new Date();
  const sameDay =
    created.getUTCFullYear() === now.getUTCFullYear() &&
    created.getUTCMonth() === now.getUTCMonth() &&
    created.getUTCDate() === now.getUTCDate();
  if (sameDay) {
    const time = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(created);
    return `Today, ${time} UTC`;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(created);
}
