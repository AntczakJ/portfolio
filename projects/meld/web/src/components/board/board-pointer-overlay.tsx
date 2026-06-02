'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

import { paintPreviewFreehand } from '@/lib/canvas/painters/freehand-preview';
import { FreehandDraft } from '@/lib/canvas/freehand-draft';
import { colorSlotFor } from '@/lib/identity/fnv1a';
import type { ToolKind } from '@/lib/shapes/kinds';
import {
  createShape,
  DEFAULT_TEXT_FONT_SIZE,
  SHAPES_ROOT_KEY,
} from '@/lib/shapes/types';
import { OpRateGuard, nowMs } from '@/lib/yjs/op-rate-guard';
import { useToolStore } from '@/lib/stores/tool-store';
import { useWelcomeStore } from '@/lib/stores/welcome-store';

/**
 * Pointer overlay — Phase 3.2.
 *
 * A transparent `<div>` stretched across the canvas region captures
 * pointer events; the drawing canvases (shape + cursor) keep their
 * existing semantics (shape paints from Yjs observer, cursor paints
 * from awareness change). This division of labour means:
 *
 *   - the engine's subscribe-once + dirty-flag discipline stays
 *     intact — pointer events do NOT flip engine dirty flags
 *     directly,
 *   - drafts (the rectangle / ellipse being dragged out, the
 *     freehand stroke being built) are painted into a dedicated
 *     "preview" canvas SIBLING to the engine canvases. The preview
 *     is owned by this component, not the engine, so it can clear
 *     and re-paint at pointer-event cadence without going through
 *     a Yjs round-trip.
 *
 * Tool dispatch per ADR-008 + Phase 3.2 brief:
 *
 *   - `'select'`     — no shape creation. Cursor stays as the OS
 *                      pointer. Phase 3.2b adds the selection chrome
 *                      hover/click handling here.
 *   - `'rectangle'`  — pointerdown starts a draft, pointermove updates
 *                      the preview, pointerup commits to the root
 *                      shapes Y.Map inside one `doc.transact`.
 *   - `'ellipse'`    — same as rectangle, different preview render.
 *   - `'freehand'`   — ADR-010 (option F2). pointerdown starts an
 *                      in-memory `FreehandDraft` (NO Yjs write);
 *                      pointermove samples the pointer into the draft
 *                      (decimated — min-distance 2 px OR 16 ms gate,
 *                      2000-point ceiling) and repaints the stroke-
 *                      so-far on the preview canvas for instant LOCAL
 *                      feedback; pointerup commits the WHOLE stroke as
 *                      ONE shape — `createShape({ kind: 'freehand',
 *                      initialPoints: <full draft list> })` + a single
 *                      root `set` inside one `doc.transact`. No
 *                      per-point Yjs writes — the wire sees one op per
 *                      stroke, not ~60/sec. Remote tabs see the
 *                      completed stroke on release (the DoS-aligned
 *                      trade ADR-010 accepts for v1). The engine's
 *                      shallow `Y.Map.observe` catches the single root
 *                      insert — NO `observeDeep`.
 *   - `'text'`       — pointerdown drops a DOM `<input type="text">`
 *                      anchored at the click point, auto-focused.
 *                      Enter / blur commits to a new text shape;
 *                      Escape cancels (no shape is committed). The
 *                      empty-text-shape-and-update pattern is
 *                      rejected because it would briefly show a
 *                      blank text shape on remote tabs.
 *
 * Color slot resolution: the local user's `colorSlot` is the per-board
 * derivation `fnv1a32(sessionId + ':' + boardId) % 8` (ADR-005),
 * mirrored client-side in `src/lib/identity/fnv1a.ts`. Until the WS
 * welcome frame arrives, the welcome-store's `session.id` is null —
 * we fall back to slot 0 (brand violet) and the colour will reconcile
 * when the welcome frame lands. The shape's `colorSlot` field is
 * authoritative; the painter resolves it against the live palette,
 * so subsequent theme flips re-tone the shape without rewriting it.
 *
 * Text overlay DOM input pattern: an absolutely-positioned `<input>`
 * with system font + same font size as the painted text shape. The
 * caret is the user's cue that "the next keystroke goes here, NOT
 * into a global hotkey". The toolbar's keyboard shortcut listener
 * (`board-toolbar.tsx`) already excludes input/textarea/contenteditable
 * focus, so typing `R` inside the text overlay does not switch tools.
 */

export interface BoardPointerOverlayProps {
  /** Live Yjs document — pointer commits write into `doc.getMap('shapes')`. */
  doc: Y.Doc;
  /** Board id — drives the per-board OKLCH color slot derivation. */
  boardId: string;
  /**
   * Live `Awareness` instance from the active `HocuspocusProvider`. The
   * overlay writes the local cursor position into `awareness.local.
   * cursor` on every pointermove (throttled to ~30 ms — see
   * `CURSOR_WRITE_THROTTLE_MS`) and clears it on pointerleave so remote
   * peers see our cursor disappear when our pointer leaves the canvas.
   *
   * Pass `null` while the host is still constructing the provider — the
   * cursor writes are simply skipped until awareness lands; no crash.
   */
  awareness: Awareness | null;
}

/**
 * Cursor write throttle — 30 ms ≈ 33 fps awareness updates, well under
 * the 60 fps engine paint cadence (the engine's lerp loop smooths
 * between samples, so a sparser awareness stream still reads as a
 * fluid cursor on remote tabs). 30 ms is also the rate cap that keeps
 * us well below Hocuspocus's `maxRate` extension (ADR-002 backpressure)
 * even at sustained pointer activity.
 */
const CURSOR_WRITE_THROTTLE_MS = 30;

interface RectDraft {
  kind: 'rectangle' | 'ellipse';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/**
 * The active freehand stroke draft (ADR-010 F2). Wraps the in-memory
 * `FreehandDraft` accumulator — NO Yjs shapeMap is created until the
 * single commit on pointerup. `colorSlot` is snapshotted at pointerdown
 * for the live preview color; the commit re-resolves identity so a
 * welcome frame landing mid-stroke colours the committed shape.
 */
interface FreehandDraftState {
  kind: 'freehand';
  draft: FreehandDraft;
  colorSlot: number;
}

interface TextDraft {
  kind: 'text';
  x: number;
  y: number;
}

type ActiveDraft = RectDraft | FreehandDraftState | null;

/** Minimum on-canvas pixels before a rect / ellipse commit is allowed. */
const MIN_RECT_DIMENSION = 4;

export function BoardPointerOverlay({
  doc,
  boardId,
  awareness,
}: BoardPointerOverlayProps): ReactNode {
  const tool = useToolStore((s) => s.tool);
  const setTool = useToolStore((s) => s.setTool);
  const welcome = useWelcomeStore((s) => s.welcome);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const draftRef = useRef<ActiveDraft>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);

  // ADR-010 §3 — client op-rate guard. A token bucket on Yjs op COMMITS
  // (one `doc.transact` = one op). Applied at the commit boundary, NOT
  // per-shape, so a 50-shape paste in one transact counts as one op and
  // is never throttled. Calibrated under the server `maxRate: 100`
  // (CLIENT_OP_RATE_CEILING = 40 / CLIENT_OP_BURST_ALLOWANCE = 20) so a
  // runaway client self-limits before earning a `4290`. Lazily created
  // so the clock seed is the first commit's `nowMs()`.
  const opGuardRef = useRef<OpRateGuard | null>(null);

  // Guarded commit boundary. Every Yjs write the overlay makes flows
  // through here so the op guard + the dev `[meld-ops]` counter see one
  // op per `doc.transact`. When the bucket is empty the commit is
  // deferred (the per-tool contract means this effectively never fires
  // for a normal user — it is the runaway-client safety net). The whole
  // mutation runs inside a single `doc.transact`.
  const commitOp = useCallback(
    (mutate: () => void): boolean => {
      let guard = opGuardRef.current;
      const t = nowMs();
      if (guard === null) {
        guard = new OpRateGuard(t);
        opGuardRef.current = guard;
      }
      const decision = guard.tryConsume(t);
      if (!decision.allowed) {
        // Bucket empty — defer this commit to stay under the server
        // limit. The local preview already gave the user feedback; the
        // dropped commit is the graceful-degradation path for a runaway
        // client, not a normal-use path.
        return false;
      }
      doc.transact(mutate);
      return true;
    },
    [doc],
  );

  // Cursor-write throttle. We snapshot `performance.now()` at every
  // write; a write fires only if `now - lastCursorWriteMs >= 30 ms`.
  // The awareness update IS the rate limiter — no rAF gating here.
  const lastCursorWriteMsRef = useRef(0);
  // Track whether we currently report a non-null cursor. On unmount we
  // emit a final `null` so a torn-down provider does not leave a stale
  // cursor for remote peers to see.
  const cursorReportedRef = useRef(false);

  /* ---------------------------------------------------------- *\
     Identity helpers
  \* ---------------------------------------------------------- */

  // The session id seeds both `createdBy` / `lastEditedBy` and the
  // color-slot derivation. We snapshot at use time (not as a memo
  // dep) because the welcome frame can land mid-draft — the rect we
  // commit on pointerup should reflect the identity in force at
  // commit, not at pointerdown. Falling back to `'local'` keeps the
  // call site safe before the welcome arrives; a real welcome frame
  // overwrites the field on the next edit.
  const resolveIdentity = useCallback((): { sessionId: string; colorSlot: number } => {
    const sessionId = welcome?.session.id ?? 'local';
    const colorSlot = welcome ? colorSlotFor(sessionId, boardId) : 0;
    return { sessionId, colorSlot };
  }, [welcome, boardId]);

  /* ---------------------------------------------------------- *\
     Preview canvas — DPR sync
  \* ---------------------------------------------------------- */

  useEffect(() => {
    const overlay = overlayRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (overlay === null || previewCanvas === null) return undefined;
    const syncSize = (): void => {
      const rect = overlay.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      previewCanvas.width = Math.max(1, Math.round(rect.width * dpr));
      previewCanvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = previewCanvas.getContext('2d');
      if (ctx !== null) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(overlay);
    return () => {
      observer.disconnect();
    };
  }, []);

  /* ---------------------------------------------------------- *\
     Preview painter — runs at pointer-event cadence
  \* ---------------------------------------------------------- */

  const clearPreview = useCallback((): void => {
    const previewCanvas = previewCanvasRef.current;
    if (previewCanvas === null) return;
    const ctx = previewCanvas.getContext('2d');
    if (ctx === null) return;
    const rect = previewCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
  }, []);

  const paintPreviewRect = useCallback((draft: RectDraft, colorSlot: number): void => {
    const previewCanvas = previewCanvasRef.current;
    if (previewCanvas === null) return;
    const ctx = previewCanvas.getContext('2d');
    if (ctx === null) return;
    const overlay = overlayRef.current;
    if (overlay === null) return;
    const rect = overlay.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    const x = Math.min(draft.startX, draft.endX);
    const y = Math.min(draft.startY, draft.endY);
    const w = Math.abs(draft.endX - draft.startX);
    const h = Math.abs(draft.endY - draft.startY);

    // Resolve the awareness color via getComputedStyle once per
    // preview frame. NOT through the engine's theme bridge — the
    // bridge is a singleton inside the canvas module and the preview
    // canvas lives in component scope. One `getPropertyValue` per
    // pointermove is a sub-microsecond cost; the engine's per-frame
    // discipline does not apply at pointer cadence.
    const fill = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(`--color-awareness-${String(colorSlot)}`)
      .trim();
    if (fill === '') return;

    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.18;
    if (draft.kind === 'rectangle') {
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    if (draft.kind === 'rectangle') {
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    } else {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }, []);

  // ADR-010 F2 — paint the in-progress freehand stroke onto the preview
  // canvas every pointermove. Same preview-canvas + same per-frame
  // `getComputedStyle` colour resolution as `paintPreviewRect`; the
  // polyline geometry is delegated to `paintPreviewFreehand` which
  // mirrors the committed-shape painter (`painters/shapes.ts`) so the
  // live stroke is visually identical to the shape that lands on commit.
  const paintFreehandPreview = useCallback(
    (draft: FreehandDraft, colorSlot: number): void => {
      const previewCanvas = previewCanvasRef.current;
      if (previewCanvas === null) return;
      const ctx = previewCanvas.getContext('2d');
      if (ctx === null) return;
      const overlay = overlayRef.current;
      if (overlay === null) return;
      const rect = overlay.getBoundingClientRect();

      const color = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(`--color-awareness-${String(colorSlot)}`)
        .trim();
      if (color === '') return;

      paintPreviewFreehand(ctx, rect.width, rect.height, draft, color);
    },
    [],
  );

  /* ---------------------------------------------------------- *\
     Pointer event handlers
  \* ---------------------------------------------------------- */

  const localPoint = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | PointerEvent): {
      x: number;
      y: number;
    } | null => {
      const overlay = overlayRef.current;
      if (overlay === null) return null;
      const rect = overlay.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    [],
  );

  /* ---------------------------------------------------------- *\
     Cursor awareness writes (Phase 3.3)
  \* ---------------------------------------------------------- */

  // Write the local cursor position into awareness, throttled at
  // ~30 ms cadence. Coordinates are in CANVAS-space (overlay-relative,
  // same coordinate system the cursor engine paints in). NOT
  // screen-space — a viewer scrolling the page would otherwise see
  // remote cursors drift.
  const writeCursor = useCallback(
    (x: number, y: number): void => {
      if (awareness === null) return;
      const t = nowMs();
      if (t - lastCursorWriteMsRef.current < CURSOR_WRITE_THROTTLE_MS) {
        return;
      }
      lastCursorWriteMsRef.current = t;
      awareness.setLocalStateField('cursor', { x, y });
      cursorReportedRef.current = true;
    },
    [awareness],
  );

  const clearCursor = useCallback((): void => {
    if (awareness === null) return;
    if (!cursorReportedRef.current) return;
    awareness.setLocalStateField('cursor', null);
    cursorReportedRef.current = false;
    // Reset the throttle so the next pointermove writes immediately —
    // a peer returning to the canvas should not have to wait through
    // a 30 ms window before their cursor reappears.
    lastCursorWriteMsRef.current = 0;
  }, [awareness]);

  // On unmount or awareness swap, emit a final `null` so remote peers
  // see our cursor disappear even if the React tree tore down mid-
  // gesture. Same teardown safety we'd want for any wire-attached
  // ephemeral state.
  useEffect(() => {
    return () => {
      if (awareness !== null && cursorReportedRef.current) {
        awareness.setLocalStateField('cursor', null);
        cursorReportedRef.current = false;
      }
    };
  }, [awareness]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (tool === 'select') return;
      // Only the primary (left) pointer button starts a draft. Right
      // click stays available for native browser context-menu while we
      // do not yet ship our own.
      if (event.button !== 0) return;
      const point = localPoint(event);
      if (point === null) return;

      // Capture pointer so pointermove + pointerup keep arriving even
      // when the cursor exits the overlay bounds (drag to the edge of
      // the canvas region, etc.).
      event.currentTarget.setPointerCapture(event.pointerId);

      const { colorSlot } = resolveIdentity();

      if (tool === 'rectangle' || tool === 'ellipse') {
        draftRef.current = {
          kind: tool,
          startX: point.x,
          startY: point.y,
          endX: point.x,
          endY: point.y,
        };
        clearPreview();
        return;
      }

      if (tool === 'freehand') {
        // ADR-010 F2 — start an IN-MEMORY draft. NO Yjs write on
        // pointerdown: the shape is built and committed once on
        // pointerup. The preview canvas gives the live local feedback.
        const draft = new FreehandDraft({
          x: point.x,
          y: point.y,
          tMs: nowMs(),
        });
        draftRef.current = { kind: 'freehand', draft, colorSlot };
        clearPreview();
        paintFreehandPreview(draft, colorSlot);
        return;
      }

      // Only `'text'` remains (select / rectangle / ellipse / freehand
      // each returned above). Drop a DOM input at the click point; the
      // actual text shape is created only on commit. Cancel-on-Escape
      // keeps an empty text shape from materialising on remote tabs.
      setTextDraft({ kind: 'text', x: point.x, y: point.y });
    },
    [tool, localPoint, clearPreview, resolveIdentity, paintFreehandPreview],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const point = localPoint(event);
      if (point === null) return;

      // Cursor write — fires on every pointermove regardless of the
      // active tool (Phase 3.3). Throttled to ~30 ms inside writeCursor.
      writeCursor(point.x, point.y);

      const draft = draftRef.current;
      if (draft === null) return;

      // Switch on the draft discriminant so each branch narrows cleanly
      // (a plain `if (kind === 'freehand')` after the rect/ellipse return
      // is a no-op guard the type-checker proves redundant, yet TS does
      // not collapse the union without it — the switch gives both the
      // narrowing AND a lint-clean exhaustive shape).
      switch (draft.kind) {
        case 'rectangle':
        case 'ellipse': {
          const { colorSlot } = resolveIdentity();
          draft.endX = point.x;
          draft.endY = point.y;
          paintPreviewRect(draft, colorSlot);
          return;
        }
        case 'freehand': {
          // ADR-010 F2 — sample into the in-memory draft (decimated by
          // min-distance / time gate inside `FreehandDraft.push`) and
          // repaint the stroke-so-far on the preview canvas. NO Yjs write
          // here — the whole stroke commits once on pointerup.
          const admitted = draft.draft.push({
            x: point.x,
            y: point.y,
            tMs: nowMs(),
          });
          if (admitted) {
            paintFreehandPreview(draft.draft, draft.colorSlot);
          }
          return;
        }
      }
    },
    [localPoint, paintPreviewRect, paintFreehandPreview, resolveIdentity, writeCursor],
  );

  const handlePointerLeave = useCallback(
    (): void => {
      // Off-canvas — clear the remote cursor. The local OS pointer
      // is still visible to the user; this only affects what remote
      // peers see (the engine's opacity ramp fades the cursor out
      // over ~200 ms on the receiving side).
      clearCursor();
    },
    [clearCursor],
  );

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      // Pointer re-entered the canvas — write the new position
      // immediately so the engine on the receiving side fades the
      // cursor back in at the entry point, not at the stale last-
      // seen coordinate.
      const point = localPoint(event);
      if (point === null) return;
      writeCursor(point.x, point.y);
    },
    [localPoint, writeCursor],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const draft = draftRef.current;
      if (draft === null) return;
      const point = localPoint(event);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const { sessionId, colorSlot } = resolveIdentity();

      if ((draft.kind === 'rectangle' || draft.kind === 'ellipse') && point !== null) {
        const x = Math.min(draft.startX, point.x);
        const y = Math.min(draft.startY, point.y);
        const w = Math.abs(point.x - draft.startX);
        const h = Math.abs(point.y - draft.startY);
        clearPreview();
        draftRef.current = null;
        if (w < MIN_RECT_DIMENSION || h < MIN_RECT_DIMENSION) return;
        const { id: shapeId, map: shapeMap } = createShape({
          kind: draft.kind,
          x,
          y,
          w,
          h,
          colorSlot,
          sessionId,
        });
        // ONE op through the rate-guarded commit boundary (ADR-010 §3).
        commitOp(() => {
          doc.getMap(SHAPES_ROOT_KEY).set(shapeId, shapeMap);
        });
        return;
      }

      if (draft.kind === 'freehand') {
        // ADR-010 F2 — commit the WHOLE stroke as ONE shape. Finalize
        // the draft with the pointerup point (always kept), build the
        // shape from the full decimated point list, and insert it once.
        // The engine's shallow root `observe` fires on this single root
        // `set` and repaints the finished stroke. Drop the preview.
        const finalPoint = point ?? {
          x: draft.draft.baseX,
          y: draft.draft.baseY,
        };
        const initialPoints = draft.draft.finalize(finalPoint);
        clearPreview();
        draftRef.current = null;
        // A degenerate stroke (the draft only ever held the single
        // origin point and the pointerup coincided) still commits as a
        // one-point dot — the painter renders it. No minimum-length gate
        // for freehand (a deliberate tap IS a dot).
        const { id: shapeId, map: shapeMap } = createShape({
          kind: 'freehand',
          x: draft.draft.baseX,
          y: draft.draft.baseY,
          initialPoints,
          colorSlot,
          sessionId,
        });
        commitOp(() => {
          doc.getMap(SHAPES_ROOT_KEY).set(shapeId, shapeMap);
        });
        return;
      }
    },
    [doc, clearPreview, localPoint, resolveIdentity, commitOp],
  );

  // If the pointer is cancelled (page hidden, OS-level interruption),
  // discard the draft entirely — including the preview. Under ADR-010
  // F2 nothing is committed to Yjs during the drag (freehand points
  // live only in the in-memory draft until pointerup), so a cancel
  // cleanly drops the whole in-progress stroke with no Yjs rollback
  // needed. The user simply starts over — the correct intent for an OS
  // interruption mid-gesture.
  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const draft = draftRef.current;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (draft === null) return;
      clearPreview();
      draftRef.current = null;
    },
    [clearPreview],
  );

  /* ---------------------------------------------------------- *\
     Text overlay input commit handlers
  \* ---------------------------------------------------------- */

  const commitTextDraft = useCallback(
    (text: string): void => {
      const draft = textDraft;
      if (draft === null) return;
      setTextDraft(null);
      const trimmed = text.trim();
      if (trimmed === '') return;
      const { sessionId, colorSlot } = resolveIdentity();
      const { id: shapeId, map: shapeMap } = createShape({
        kind: 'text',
        x: draft.x,
        y: draft.y,
        text: trimmed,
        fontSize: DEFAULT_TEXT_FONT_SIZE,
        colorSlot,
        sessionId,
      });
      // ONE op through the rate-guarded commit boundary (ADR-010 §3).
      commitOp(() => {
        doc.getMap(SHAPES_ROOT_KEY).set(shapeId, shapeMap);
      });
      // Revert to select after committing a text shape — same
      // convention as Figma; otherwise every click would spawn
      // another text input.
      setTool('select');
    },
    [doc, textDraft, resolveIdentity, setTool, commitOp],
  );

  const cancelTextDraft = useCallback((): void => {
    setTextDraft(null);
  }, []);

  /* ---------------------------------------------------------- *\
     Cursor styling per tool
  \* ---------------------------------------------------------- */

  const cursor: CSSProperties['cursor'] =
    tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <>
      <canvas
        ref={previewCanvasRef}
        data-meld-layer="preview"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      />
      <div
        ref={overlayRef}
        // The overlay is invisible but absorbs pointer events when a
        // drawing tool is active. When `tool === 'select'` it stays
        // mounted so Phase 3.2b can plug in hover/click handlers
        // without re-architecting the surface.
        //
        // Phase 3.3: pointermove writes the local cursor position into
        // awareness (throttled to ~30 ms) regardless of the active
        // tool, and pointerleave clears it so remote peers see our
        // cursor disappear off-canvas. Pointerenter writes immediately
        // so a returning peer's cursor fades back in at the right spot.
        className="absolute inset-0 h-full w-full"
        style={{ cursor }}
        data-meld-layer="pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      />
      {textDraft !== null ? (
        <TextDraftInput
          x={textDraft.x}
          y={textDraft.y}
          onCommit={commitTextDraft}
          onCancel={cancelTextDraft}
        />
      ) : null}
    </>
  );
}

/* ============================================================== *\
   Text draft input — DOM-rendered above the canvases
\* ============================================================== */

interface TextDraftInputProps {
  x: number;
  y: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

function TextDraftInput({
  x,
  y,
  onCommit,
  onCancel,
}: TextDraftInputProps): ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  // Auto-focus on mount so the user can type immediately. `setTimeout`
  // 0 defers focus to after the synchronous render commit, avoiding a
  // race where the click that opened the input is still being
  // processed by the overlay's pointerup.
  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // Stop propagation so global tool shortcuts (R / E / P / T / V)
    // do not fire while typing. The toolbar's listener also skips
    // input focus, but defence in depth is one cheap LOC.
    event.stopPropagation();
    if (event.key === 'Enter') {
      committedRef.current = true;
      onCommit(event.currentTarget.value);
    } else if (event.key === 'Escape') {
      committedRef.current = true;
      onCancel();
    }
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(event.currentTarget.value);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue=""
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      // Inline styles for the genuinely dynamic position; everything
      // else is Tailwind.
      style={{
        position: 'absolute',
        left: `${x.toString()}px`,
        top: `${y.toString()}px`,
        font: `${DEFAULT_TEXT_FONT_SIZE.toString()}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
      }}
      className="z-20 min-w-[6rem] border-b-2 border-(--color-accent) bg-transparent px-1 py-0 text-(--color-fg) outline-none"
      placeholder="Type and press Enter"
      aria-label="Text label content"
    />
  );
}

// Phase 3.2 deferred: a more polished text input (resize-as-you-type,
// font-size picker, multi-line via `<textarea>`). Phase 3.2b plus
// design-critic review will pull these forward.

/**
 * Hook surfaced for downstream toolbar / chrome to apply the same
 * "currently active tool" semantic without re-importing the store.
 * The store path is the canonical one; this re-export keeps the
 * pointer overlay self-contained for tests.
 *
 * @internal — exported only for the test suite. Production consumers
 * should `import { useToolStore } from '@/lib/stores/tool-store'`.
 */
export function useActiveTool(): ToolKind {
  return useToolStore((s) => s.tool);
}

// Silence verbatimModuleSyntax type-only hint — the import is used
// by the explicit annotation above.
export type { ToolKind };
