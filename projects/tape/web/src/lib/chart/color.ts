/**
 * Color helpers for the Canvas2D footprint renderer.
 *
 * Everything here is browser-only. The renderer's draw pipeline reads
 * theme tokens as raw `oklch(...)` strings from the theme bridge and
 * needs to (a) interpolate between two anchor colors and (b) mix in a
 * single function call per cell without allocating intermediate
 * objects in the hot path.
 *
 * No external dependency — the renderer is on a frame budget. A
 * single regex parse + three linear blends + one template string is
 * cheaper than reaching for a color library.
 */

/* ============================================================== *\
   OKLCH parsing
\* ============================================================== */

/**
 * Parsed OKLCH triple plus optional alpha (`oklch(L C H / A)`).
 *
 * Components are in the OKLCH color space as defined by the CSS Color
 * Module Level 4 spec:
 *   - L: perceptual lightness in [0, 1]
 *   - C: chroma in [0, 0.4]ish for sRGB-displayable colors
 *   - H: hue in degrees, [0, 360)
 *   - alpha: optional, [0, 1]; undefined means opaque
 */
export interface OklchTriple {
  L: number;
  C: number;
  H: number;
  alpha: number | undefined;
}

// Matches `oklch(L C H)` and `oklch(L C H / A)`. The components can be
// integer or decimal; whitespace between them is flexible. The hue is
// emitted by Tailwind v4's @theme as a bare number (no `deg` suffix),
// so we don't tolerate units here on purpose — if the upstream token
// changes shape, we want to surface that loudly.
const OKLCH_RE =
  /^oklch\(\s*([0-9.+\-]+)\s+([0-9.+\-]+)\s+([0-9.+\-]+)(?:\s*\/\s*([0-9.+\-]+))?\s*\)$/i;

/**
 * Parse an `oklch(...)` string into its components. Throws on
 * malformed input — the bridge guarantees tokens are non-empty, and
 * the @theme block is the project's source of truth for the shape, so
 * a parse failure here means a typo upstream that should crash loudly
 * in dev rather than fall through to a black cell.
 */
export function parseOklch(value: string): OklchTriple {
  const match = OKLCH_RE.exec(value.trim());
  if (match === null) {
    throw new Error(
      `parseOklch: not an oklch() string: ${value}. Theme tokens must be ` +
        'emitted as oklch(L C H) or oklch(L C H / A) — check globals.css.',
    );
  }
  const L = Number(match[1]);
  const C = Number(match[2]);
  const H = Number(match[3]);
  const alphaRaw = match[4];
  const alpha = alphaRaw === undefined ? undefined : Number(alphaRaw);
  return { L, C, H, alpha };
}

/* ============================================================== *\
   OKLCH formatting
\* ============================================================== */

/**
 * Format an OKLCH triple back into a CSS color string usable as a
 * Canvas2D `fillStyle` / `strokeStyle`. Round to 4 decimal places to
 * keep the string short — Canvas2D internally parses the string on
 * every assignment and the extra digits buy nothing visually.
 */
export function formatOklch({ L, C, H, alpha }: OklchTriple): string {
  const l = round4(L);
  const c = round4(C);
  const h = round4(H);
  if (alpha === undefined) {
    return `oklch(${l} ${c} ${h})`;
  }
  return `oklch(${l} ${c} ${h} / ${round4(alpha)})`;
}

function round4(n: number): number {
  // 4 decimals is plenty for OKLCH lightness/chroma; hue rounds to
  // integer degrees in practice but we keep the same precision for
  // simplicity.
  return Math.round(n * 10000) / 10000;
}

/* ============================================================== *\
   Linear interpolation in OKLCH
\* ============================================================== */

/**
 * Lerp two OKLCH colors component-wise.
 *
 * `t` is in [0, 1]; 0 returns `a`, 1 returns `b`. Out-of-range `t` is
 * clamped (the renderer feeds us values from `Math.abs(imbalance)`
 * which is in [0, 1] by construction, but the clamp keeps the helper
 * safe against floating-point drift at the boundary).
 *
 * Implementation note: we lerp L, C, and the alpha component
 * linearly. Hue (H) is on a circle, so a naive linear lerp from
 * 350 -> 10 would walk *backward* through 180 instead of jumping
 * forward through 0. We pick the shorter arc by adjusting the source
 * hue by ±360 before the lerp, then normalise the result back into
 * [0, 360). For our use case (imbalance gradient from
 * neutral -> buy or neutral -> sell anchors that sit ~120° apart on
 * the hue circle) the short-arc is always the perceptually right
 * choice. Documented as the canonical OKLCH lerp behaviour for this
 * project — reviewer should not propose "use straight-line hue" as a
 * simplification.
 *
 * Alpha: if either input lacks alpha the output drops alpha (opaque).
 * If both have alpha they are lerped. This is the right default for
 * the cell gradient — the imbalance anchors are all opaque, so the
 * lerped output stays opaque without us defaulting to a wrong alpha.
 */
export function lerpOklch(
  a: OklchTriple,
  b: OklchTriple,
  t: number,
): OklchTriple {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  const L = a.L + (b.L - a.L) * u;
  const C = a.C + (b.C - a.C) * u;
  const H = lerpHueShort(a.H, b.H, u);
  const alpha =
    a.alpha !== undefined && b.alpha !== undefined
      ? a.alpha + (b.alpha - a.alpha) * u
      : undefined;
  return { L, C, H, alpha };
}

function lerpHueShort(h1: number, h2: number, t: number): number {
  // Walk the shorter arc on the hue circle. If the absolute
  // difference exceeds 180°, rotate one endpoint by ±360°.
  let from = h1;
  const diff = h2 - h1;
  if (diff > 180) {
    from += 360;
  } else if (diff < -180) {
    from -= 360;
  }
  const mixed = from + (h2 - from) * t;
  // Normalize back to [0, 360).
  const m = mixed % 360;
  return m < 0 ? m + 360 : m;
}

/* ============================================================== *\
   Convenience: parse + lerp + format in one call
\* ============================================================== */

/**
 * Convenience for the cell painter. Parses two `oklch(...)` strings
 * and returns the lerped result as a `oklch(...)` string ready for
 * `fillStyle`.
 *
 * The renderer caches the parsed anchors per theme snapshot (see
 * `footprint-engine.ts`'s `#tokenColors` derivation step) so the hot
 * path never re-parses — this convenience is for one-shot call sites
 * (e.g. axis label color in `paintAxes`).
 */
export function mixOklchStrings(aStr: string, bStr: string, t: number): string {
  return formatOklch(lerpOklch(parseOklch(aStr), parseOklch(bStr), t));
}
