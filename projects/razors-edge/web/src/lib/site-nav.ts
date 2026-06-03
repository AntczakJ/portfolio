/**
 * Primary navigation contract for the marketing site.
 *
 * Anchors map to the long-form sections (Phase 4 builds the section
 * bodies; the ids are reserved here so the header nav and `aria-current`
 * tracking are wired now). The "Book a chair" CTA routes to `/book`
 * (the focused booking sub-experience, built Phase 4).
 */
export interface NavItem {
  label: string;
  /** In-page anchor target id (without the `#`). */
  target: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Services', target: 'services' },
  { label: 'Gallery', target: 'gallery' },
  { label: 'Barbers', target: 'barbers' },
  { label: 'Visit', target: 'visit' },
];

export const BOOK_HREF = '/book';
