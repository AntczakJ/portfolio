import type { ReactNode, SVGProps } from 'react';

/**
 * Minimal brand glyphs for social links. lucide-react removed its brand
 * icons (Instagram / Facebook / TikTok) in recent versions, and CLAUDE.md
 * § 2 forbids emoji, so these are hand-rolled inline SVGs — sharp at any
 * size, themeable via `currentColor`, decorative (the accessible name comes
 * from the link's `aria-label`).
 */

export function InstagramGlyph(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function FacebookGlyph(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14 8.5V6.8c0-.7.5-1.1 1.2-1.1H16.5V3h-2.3C11.9 3 11 4.4 11 6.4V8.5H9v2.8h2V21h3v-9.7h2.2l.4-2.8H14Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function TikTokGlyph(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14 3c.3 2.1 1.6 3.8 3.7 4.2v2.6c-1.3 0-2.6-.4-3.7-1.1v5.5c0 2.9-2.1 5.3-5 5.3s-5-2.4-5-5.3 2.1-5.3 5-5.3c.3 0 .6 0 .9.1v2.7a2.5 2.5 0 0 0-.9-.2c-1.4 0-2.4 1.2-2.4 2.7s1 2.7 2.4 2.7 2.4-1.2 2.4-2.7V3H14Z"
        fill="currentColor"
      />
    </svg>
  );
}
