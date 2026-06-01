import type { Viewport } from '../viewport';

/**
 * Cursor painter — Phase 3.3.
 *
 * Iterates the engine's per-peer cursor render-state map (NOT the raw
 * `Awareness` instance — the engine maintains `currentX/Y` separately
 * from the awareness `targetX/Y` so the rAF loop can lerp). For each
 * visible cursor:
 *
 *   1. Draw a small Linear/Figma-style arrow glyph at `(currentX,
 *      currentY)` in the peer's awareness-slot color.
 *   2. Draw a name pill BELOW-RIGHT of the cursor tip containing
 *      `${emojiChar} ${emojiName}` in 10 px Inter (matches Phase 3.2
 *      text shape font stack for visual coherence). Pill bg =
 *      `palette.surface` at 90% opacity; border = peer color at 0.4
 *      alpha; text = `palette.fg`.
 *
 * Paint cost target (ADR-008 budget): ~0.3 ms per peer pill. With the
 * 8-slot wheel cap (ADR-005) the painter's p99 stays under ~3 ms even
 * at full saturation — well inside the cursor-canvas frame budget.
 *
 * Subscribe-once contract:
 *   The painter is a pure function. It does NOT subscribe to the
 *   Awareness instance directly (the engine owns the subscription).
 *   The engine passes a frozen view of its per-peer render state on
 *   every tick.
 *
 * Off-canvas fade:
 *   `opacity < 1` is the engine's signal that the peer's cursor went
 *   off-canvas; the painter blends each peer with the running opacity
 *   via `ctx.globalAlpha`. The engine removes the peer entirely when
 *   the fade completes (opacity reaches 0).
 *
 * Local-cursor skip:
 *   The OS pointer already renders the local cursor. The engine excludes
 *   the local session id from the cursor render map BEFORE this painter
 *   sees it, so the painter does not need a per-peer skip check.
 *
 * Cross-platform emoji font note:
 *   Canvas2D `fillText` renders emoji via the system emoji font stack
 *   (Apple Color Emoji on macOS, Segoe UI Emoji on Windows, Noto Color
 *   Emoji on Linux). All three render Unicode 15.1 animal + food emoji
 *   from the ADR-005 whitelist correctly. The Inter font stack we name
 *   for the pill text is a sans fallback chain; the browser falls
 *   through to the emoji font ONLY for the codepoint range that lacks
 *   a glyph in the named sans, so `${emojiChar} ${emojiName}` renders
 *   as `<emoji-color> <plain-sans-name>` reliably across platforms.
 */
export interface CursorsPalette {
  /** Foreground for the name-pill text. */
  readonly fg: string;
  /** Pill background — surface color at 90% alpha applied by the painter. */
  readonly surface: string;
  /** 8-slot awareness wheel — indexed by `colorSlot` from awareness state. */
  readonly awarenessSlots: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
}

/**
 * The engine's per-peer render state, as the painter sees it. The
 * engine owns the source of truth for `currentX/Y` (the lerp result)
 * and the running opacity; the painter is a pure visual projection.
 */
export interface CursorRenderState {
  readonly clientId: number;
  readonly currentX: number;
  readonly currentY: number;
  readonly opacity: number;
  readonly emojiChar: string;
  readonly emojiName: string;
  readonly colorSlot: number;
}

/* ============================================================== *\
   Glyph geometry constants
\* ============================================================== */

/**
 * The arrow glyph is the canonical Linear / Figma pen-tip — a
 * triangle anchored at the cursor tip with a slight clockwise tilt
 * so the tip reads as "pointing into the canvas" rather than
 * "perfectly vertical". The three points are board-space deltas
 * relative to the cursor tip at `(0, 0)`:
 *
 *   - tip       : (0, 0)
 *   - left base : (3,  18)   — opens toward 4 o'clock
 *   - notch     : (8,  12)   — pulls back so the tail is hollow,
 *                              matching Linear's silhouette
 *   - right base: (14, 14)   — opens toward 5 o'clock, with a small
 *                              asymmetry vs left base to telegraph
 *                              the cursor's vertical handedness
 *
 * All deltas are in CSS pixels. The painter walks them once per peer
 * via `moveTo`/`lineTo` (no Path2D allocation per frame, per the
 * shapes painter's `noUnusedParameters` discipline).
 */
const ARROW_TIP_X = 0;
const ARROW_TIP_Y = 0;
const ARROW_LEFT_BASE_X = 3;
const ARROW_LEFT_BASE_Y = 18;
const ARROW_NOTCH_X = 7;
const ARROW_NOTCH_Y = 13;
const ARROW_RIGHT_BASE_X = 14;
const ARROW_RIGHT_BASE_Y = 14;

/**
 * Pill font — 11 px (Phase 4.3 D-05).
 *
 * Bumped from 10 px to 11 px — just under Linear's 12 px baseline,
 * legible at standard desktop zoom without ballooning the pill past
 * the small-on-canvas footprint the cursors warrant. The natural
 * emoji slot sits next to this text via the system emoji font stack
 * (Apple Color Emoji / Segoe UI Emoji / Noto Color Emoji), unchanged.
 */
const PILL_FONT =
  '11px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const PILL_OFFSET_X = 14;
const PILL_OFFSET_Y = 16;
const PILL_PADDING_X = 6;
// Corner radius bumped 4 → 6 (Phase 4.3 D-05) — softer, more Linear-
// feel, paint cost unchanged (still one `roundedRectPath` walk).
const PILL_RADIUS = 6;
// Pill height = font line-box + 2 × vertical padding. Bumped 18 → 22
// for the 11 px font + 2 px extra vertical padding (4 → 6 px each
// side). Phase 4.3 D-05.
const PILL_HEIGHT = 22;

/**
 * Surface fill alpha — bumped 0.9 → 0.96 (Phase 4.3 D-05) so the pill
 * separates from the warm-paper canvas at standard zoom. The 0.9
 * value previously dissolved into `--color-bg` (lightness delta ~0.025
 * against `--color-surface`); 0.96 keeps the lift while remaining
 * subtly translucent so layered shapes underneath still hint through.
 */
const PILL_SURFACE_ALPHA = 0.96;

/**
 * Border stroke alpha — bumped 0.4 → 0.55 (Phase 4.3 D-05). The
 * peer's awareness color now reads as the pill's identity owner
 * rather than a barely-there tint. Still translucent enough to feel
 * like a tinted outline, not a hard frame.
 */
const PILL_BORDER_ALPHA = 0.55;

/* ============================================================== *\
   Public painter
\* ============================================================== */

export function paintCursors(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  cursors: ReadonlyArray<CursorRenderState>,
  palette: CursorsPalette,
): void {
  if (cursors.length === 0) return;
  if (vp.w <= 0 || vp.h <= 0) return;

  // One save/restore wraps the whole painter so per-cursor alpha /
  // fillStyle changes do not leak into the engine's next paint pass.
  ctx.save();
  ctx.font = PILL_FONT;
  ctx.textBaseline = 'middle';

  for (const cursor of cursors) {
    const color = palette.awarenessSlots[clampSlot(cursor.colorSlot)];
    if (color === undefined) continue;
    if (cursor.opacity <= 0) continue;

    ctx.globalAlpha = clampOpacity(cursor.opacity);

    // ---- Arrow glyph
    ctx.translate(cursor.currentX, cursor.currentY);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(ARROW_TIP_X, ARROW_TIP_Y);
    ctx.lineTo(ARROW_LEFT_BASE_X, ARROW_LEFT_BASE_Y);
    ctx.lineTo(ARROW_NOTCH_X, ARROW_NOTCH_Y);
    ctx.lineTo(ARROW_RIGHT_BASE_X, ARROW_RIGHT_BASE_Y);
    ctx.closePath();
    ctx.fill();
    // Thin stroke in the same color gives the glyph an unambiguous
    // silhouette against the background fill (a flat fill against
    // warm-paper / deep-graphite would otherwise dissolve into the
    // grid lines at small zoom).
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    // ---- Name pill
    const label = `${cursor.emojiChar} ${cursor.emojiName}`;
    const textWidth = ctx.measureText(label).width;
    const pillWidth = textWidth + PILL_PADDING_X * 2;
    const pillX = PILL_OFFSET_X;
    const pillY = PILL_OFFSET_Y;

    // Pill background — surface color, modulated by the peer's
    // overall opacity. The canvas globalAlpha is already at
    // cursor.opacity; we multiply that by PILL_SURFACE_ALPHA via a
    // temporary save. Phase 4.3 D-05: alpha bumped to 0.96 so the
    // pill separates cleanly from the warm-paper canvas.
    ctx.save();
    ctx.globalAlpha = clampOpacity(cursor.opacity) * PILL_SURFACE_ALPHA;
    ctx.fillStyle = palette.surface;
    roundedRectPath(
      ctx,
      pillX,
      pillY,
      pillWidth,
      PILL_HEIGHT,
      PILL_RADIUS,
    );
    ctx.fill();
    // Border — peer color at PILL_BORDER_ALPHA (multiplied by the
    // running opacity via the save/globalAlpha stack). Phase 4.3
    // D-05: alpha bumped 0.4 → 0.55 so the peer color owns the
    // pill identity.
    ctx.globalAlpha = clampOpacity(cursor.opacity) * PILL_BORDER_ALPHA;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    roundedRectPath(
      ctx,
      pillX + 0.5,
      pillY + 0.5,
      pillWidth - 1,
      PILL_HEIGHT - 1,
      PILL_RADIUS,
    );
    ctx.stroke();
    ctx.restore();

    // Pill text — foreground at running opacity. Inter renders the
    // plain-sans portion; the system emoji font handles the codepoint.
    ctx.fillStyle = palette.fg;
    ctx.fillText(
      label,
      pillX + PILL_PADDING_X,
      pillY + PILL_HEIGHT / 2,
    );

    // Undo the per-cursor translate so the next iteration starts at
    // canvas origin. Cheap and avoids one save/restore per peer.
    ctx.translate(-cursor.currentX, -cursor.currentY);
  }

  ctx.restore();
}

/* ============================================================== *\
   Helpers
\* ============================================================== */

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function clampSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 0;
  const n = Math.floor(slot);
  if (n < 0) return 0;
  if (n > 7) return 7;
  return n;
}

function clampOpacity(o: number): number {
  if (!Number.isFinite(o)) return 0;
  if (o < 0) return 0;
  if (o > 1) return 1;
  return o;
}
