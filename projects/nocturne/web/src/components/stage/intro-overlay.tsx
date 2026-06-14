'use client';

import type { ReactNode } from 'react';

import type { RenderRoute } from '@/lib/schemas';

/**
 * The cinematic intro / gesture gate (ADR-003 §2) — the first meaningful
 * interaction that arms the field. A real, focusable `<button>` (keyboard +
 * pointer + touch), centred over the poster still, with the wordmark + one line
 * of positioning. On activation the parent creates + resumes the AudioContext,
 * starts the source, and arms the field (the poster → live cross-fade).
 *
 * Under reduced-motion (the `calm` route) the gate is still required — audio
 * never auto-starts — but the label drops "sound on" since reactivity is muted.
 * CSS-only micro-transitions (no GSAP/Motion — ADR-001).
 */
export interface IntroOverlayProps {
  route: RenderRoute;
  onBegin: () => void | Promise<void>;
}

export function IntroOverlay({ route, onBegin }: IntroOverlayProps): ReactNode {
  const reduced = route === 'calm';
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
      <span
        // The wordmark uses its OWN viewport-bounded clamp (NOT the shared
        // --text-6xl, which scaled to 10.5rem and overflowed both edges at 390px,
        // reading "OCTURN" — D-02). The clamp floor (2.4rem) fits NOCTURNE inside
        // a 320px viewport minus the px-6 gutter. Tracking is TIGHT, not the
        // spaced --tracking-wider micro-label value (D-06): large display type
        // wants negative tracking so the eight glyphs read as one lockup.
        // `.nocturne-wordmark` carries the reveal rise AND eases the Sora `wght`
        // axis in over the same window (the signature variable-font moment,
        // D-07). Under reduced-motion the global transition/animation reset runs
        // it to its final state instantly, landing on the resting 640 weight.
        className="nocturne-wordmark block max-w-full font-[family-name:var(--font-display)]"
        style={{
          color: 'var(--hud-ink)',
          fontSize: 'clamp(2.4rem, 13vw, 10.5rem)',
          lineHeight: 'var(--leading-tight)',
          letterSpacing: 'var(--tracking-tight)',
          textShadow: '0 2px 50px rgba(0,0,0,0.55)',
        }}
      >
        NOCTURNE
      </span>
      {/* The tagline sits over the brightest part of the bloom; an additive peak
       * blows the field toward white, so muted ink alone is illegible (D-02). A
       * dedicated dark scrim pill (independent of the field) + a soft text-shadow
       * + medium weight keep it AA-legible against the worst-case bloom, while
       * staying within the cinematic register. */}
      <p
        className="hud-scrim-strong mt-5 max-w-md rounded-[var(--radius-full)] px-4 py-1.5 text-sm font-medium motion-safe:animate-[nocturne-rise_900ms_var(--ease-out-expo)_120ms_both]"
        style={{
          color: 'var(--hud-ink)',
          textShadow: '0 1px 12px rgba(0,0,0,0.6)',
        }}
      >
        A GPU particle field that breathes with sound.
      </p>
      <button
        type="button"
        onClick={() => void onBegin()}
        // `.nocturne-begin` adds a motion-safe breathing accent ring (D-12) — a
        // faint "about to happen" idle shimmer that never appears under reduced
        // motion (the ring is opacity 0 at rest and only animates under
        // no-preference). The rise entrance and hover scale are unchanged.
        className="nocturne-begin hud-scrim pointer-events-auto mt-9 rounded-full px-9 py-4 text-sm font-medium tracking-[0.16em] uppercase transition-[transform,background-color,box-shadow] duration-[var(--duration-base)] ease-[var(--ease-out-expo)] hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 motion-safe:animate-[nocturne-rise_900ms_var(--ease-out-expo)_240ms_both]"
        style={{
          color: 'var(--hud-ink)',
          boxShadow: '0 0 0 1px var(--hud-hairline), 0 8px 40px rgba(0,0,0,0.4)',
          outlineColor: 'var(--color-accent)',
        }}
      >
        {reduced ? 'Press to begin' : 'Press to begin · sound on'}
      </button>
    </div>
  );
}
