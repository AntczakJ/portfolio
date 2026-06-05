import type { ReactNode, SVGProps } from 'react';

/**
 * Hand-rolled social brand glyphs (Task 4.1).
 *
 * lucide-react v1.16 (apex's pinned version) removed brand icons, and
 * CLAUDE.md § 2 forbids emoji, so the social glyphs are inline SVGs — sharp at
 * any size, themeable via `currentColor`, decorative (the accessible name comes
 * from the link's `aria-label`). apex builds its OWN glyphs (not imported from
 * razors-edge — § 14 do-not-share): a slightly heavier 1.8 stroke to sit with
 * the technological register.
 */

export function InstagramGlyph(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect
        x="3.2"
        y="3.2"
        width="17.6"
        height="17.6"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="4.1" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.3" cy="6.7" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function FacebookGlyph(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.2 8.4V6.9c0-.7.5-1.1 1.2-1.1h1.3V2.9h-2.4C12 2.9 11 4.4 11 6.5v1.9H8.9v2.9H11V21h3.2v-9.7h2.3l.4-2.9h-2.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function TikTokGlyph(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M14.1 2.9c.3 2.2 1.7 3.9 3.9 4.3v2.7c-1.4 0-2.7-.4-3.9-1.2v5.7c0 3-2.2 5.5-5.2 5.5S3.7 17.4 3.7 14.4s2.2-5.5 5.2-5.5c.3 0 .6 0 .9.1v2.8a2.6 2.6 0 0 0-.9-.2c-1.5 0-2.5 1.2-2.5 2.8s1 2.8 2.5 2.8 2.5-1.2 2.5-2.8V2.9h2.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function XGlyph(props: SVGProps<SVGSVGElement>): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M4 3.5h4.2l4 5.5 4.6-5.5H20l-6.1 7.2L20.4 20.5h-4.2l-4.3-5.9-4.9 5.9H4.3l6.5-7.7L4 3.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
