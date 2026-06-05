/**
 * Site navigation config (Task 4.1).
 *
 * Single source of truth for the header/footer anchor nav. `target` is the
 * in-page section id the anchor jumps to (and the header tracks for
 * `aria-current`); `label` is the visible text. The long-form marketing page
 * (Phase 5) renders sections with these ids; until then the anchors resolve to
 * the ids the hero/configurator scaffolding establishes, and any missing
 * section simply has no scroll target yet (harmless — the link is a no-op
 * jump). The "Reserve" CTA is a real route, not an anchor.
 */

export interface NavItem {
  /** In-page section id (without the leading `#`). */
  readonly target: string;
  /** Visible nav label. */
  readonly label: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { target: 'configurator', label: 'Configure' },
  { target: 'fleet', label: 'Fleet' },
  { target: 'gallery', label: 'Gallery' },
  { target: 'how-it-works', label: 'How it works' },
  { target: 'locations', label: 'Locations' },
];

/** The reservation route the primary CTA points at. */
export const RESERVE_HREF = '/reserve';
