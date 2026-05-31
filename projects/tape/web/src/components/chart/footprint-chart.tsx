'use client';

/**
 * <FootprintChart /> — React shell that owns the canvas + lifecycle
 * of one `FootprintChartEngine`. Everything else (render loop, theme
 * subscription, store subscription, scroll smoothing) lives in the
 * engine.
 *
 * The shell does four things and four things only:
 *   1. Render a `<canvas>` inside a `position: relative; overflow:
 *      hidden` parent and let the canvas fill it.
 *   2. Observe size changes via `ResizeObserver` and forward them to
 *      the engine, applying device-pixel-ratio backing-store scaling.
 *   3. Wire start / stop to the React mount lifecycle. The engine
 *      handles the rAF loop internally.
 *   4. Forward pointer events to the engine — Phase 3.2's cursor
 *      channel. Pointer moves are coalesced to one engine call per
 *      rAF tick (single pending coords ref + a `requestAnimationFrame`
 *      flush) so a 1000-Hz mouse stream cannot saturate the engine
 *      with redundant `setCursor` calls between paints.
 *
 * The engine instance is published via `FootprintEngineProvider` so
 * sibling chrome (cell tooltip, Follow-live pill) can subscribe to
 * the cursor + scroll channels without prop drilling or singleton
 * leaks across mounts.
 *
 * Touch UX trade-off (documented for the next agent):
 *   - Touch on cells at 24 × 16 CSS px is imprecise; the tooltip
 *     surfaces but the user cannot see the hovered cell because their
 *     finger covers it. Phase 3.4 (zoom + pinch) is where the real
 *     mobile fix lands. For now `touchstart` / `touchmove` map to
 *     `setCursor` and `touchend` clears — minimal viable.
 *
 * We do NOT pass per-frame data through React. The engine reads the
 * Zustand store + theme bridge directly — by design.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';

import { CellTooltip } from '@/components/chart/cell-tooltip';
import { FollowLivePill } from '@/components/chart/follow-live-pill';
import { FootprintEngineProvider } from '@/lib/chart/engine-context';
import { FootprintChartEngine } from '@/lib/chart/footprint-engine';
import { useStreamStore } from '@/lib/stores/stream-store';
import { getThemeTokensBridge } from '@/lib/theme/tokens';

export function FootprintChart(): ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<FootprintChartEngine | null>(null);
  const reduceMotion = useReducedMotion();
  // State (not ref) so child consumers — `<CellTooltip />` and
  // `<FollowLivePill />` — re-render when the engine instance appears.
  // Mounts that arrive before the engine ref is populated would
  // otherwise subscribe to `null` and never recover.
  const [engine, setEngine] = useState<FootprintChartEngine | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    if (engineRef.current !== null) return;

    // Bridge + store reach into module-scope singletons — Zustand's
    // vanilla store is the same instance regardless of the React tree
    // it is consumed from, and the theme bridge is a lazy singleton.
    const themeBridge = getThemeTokensBridge();
    const created = new FootprintChartEngine(canvas, {
      themeBridge: {
        current: () => themeBridge.current(),
        subscribe: (cb) => themeBridge.subscribe(cb),
      },
      streamStore: useStreamStore,
      prefersReducedMotion: reduceMotion === true,
    });
    engineRef.current = created;
    setEngine(created);

    // Initial size — read the container's box size and apply.
    const rect = container.getBoundingClientRect();
    created.handleResize(
      rect.width,
      rect.height,
      window.devicePixelRatio || 1,
    );
    created.start();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      created.handleResize(width, height, window.devicePixelRatio || 1);
    });
    observer.observe(container);

    // ----- Pointer event wiring (Phase 3.2). -----
    // Throttle pointer-move to one engine call per rAF tick using a
    // single pending coords ref. We do NOT coalesce on the React
    // side — coalesce inside this shell only, because the engine is
    // the consumer and the engine's `setCursor` is itself cheap.
    let pendingPx: { x: number; y: number } | null = null;
    let rafToken: number | null = null;

    const flushPending = (): void => {
      rafToken = null;
      if (pendingPx === null) return;
      created.setCursor(pendingPx);
      pendingPx = null;
    };

    const updateCursorFromClientCoords = (
      clientX: number,
      clientY: number,
    ): void => {
      const r = canvas.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      pendingPx = { x, y };
      if (rafToken === null) {
        rafToken = requestAnimationFrame(flushPending);
      }
    };

    const handlePointerMove = (e: PointerEvent): void => {
      updateCursorFromClientCoords(e.clientX, e.clientY);
    };
    const handlePointerLeave = (): void => {
      if (rafToken !== null) {
        cancelAnimationFrame(rafToken);
        rafToken = null;
      }
      pendingPx = null;
      created.clearCursor();
    };
    const handleTouchStart = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (t === undefined) return;
      updateCursorFromClientCoords(t.clientX, t.clientY);
    };
    const handleTouchMove = (e: TouchEvent): void => {
      const t = e.touches[0];
      if (t === undefined) return;
      updateCursorFromClientCoords(t.clientX, t.clientY);
    };
    const handleTouchEnd = (): void => {
      handlePointerLeave();
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    // Touch listeners are passive — we never `preventDefault` on
    // them. The pointer events fire on touch devices too but mobile
    // browsers have historically been inconsistent about pointermove
    // during a touch sequence, so we belt-and-braces both.
    canvas.addEventListener('touchstart', handleTouchStart, { passive: true });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: true });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: true });
    canvas.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
      canvas.removeEventListener('touchcancel', handleTouchEnd);
      if (rafToken !== null) {
        cancelAnimationFrame(rafToken);
        rafToken = null;
      }
      created.stop();
      engineRef.current = null;
      setEngine(null);
    };
    // We intentionally ignore `reduceMotion` changes after mount —
    // the scroll smoothing is a 200 ms-class affordance, swapping it
    // mid-session would surprise the user. A reload picks up the new
    // preference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FootprintEngineProvider engine={engine}>
      <div
        ref={containerRef}
        aria-label="Footprint chart"
        className="relative h-full w-full overflow-hidden"
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          // Width / height are SET by the engine via the ResizeObserver
          // callback (backing-store pixels = CSS pixels * DPR). The CSS
          // size comes from the className above.
        />
        <CellTooltip containerRef={containerRef} />
        <FollowLivePill />
      </div>
    </FootprintEngineProvider>
  );
}
