import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BrandMark } from '../brand-mark';

/**
 * Tests for `<BrandMark />` — Phase 4.3 D-01 fix.
 *
 * Coverage:
 *   1. Renders a `<Link href="/">` wrapping the brand mark.
 *   2. Carries `aria-label="Meld home"` (the home affordance).
 *   3. Renders an inline SVG logomark (the two-overlapping-squares
 *      glyph) inside the link.
 *   4. Renders the "Meld" wordmark at 14 px Inter medium with
 *      `tracking-[-0.014em]`.
 *   5. The SVG carries `aria-hidden="true"` (the wordmark already
 *      names the brand for SR users).
 */
describe('<BrandMark />', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a link to the home route with aria-label="Meld home"', () => {
    render(<BrandMark />);
    const link = screen.getByRole('link', { name: 'Meld home' });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('renders the inline SVG logomark hidden from screen readers', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('width')).toBe('14');
    expect(svg?.getAttribute('height')).toBe('14');
  });

  it('uses the brand accent fill for the logomark path', () => {
    const { container } = render(<BrandMark />);
    const path = container.querySelector('svg path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('fill')).toBe('var(--color-accent)');
    // Even-odd fill is load-bearing for the overlap silhouette.
    expect(path?.getAttribute('fill-rule')).toBe('evenodd');
  });

  it('renders the "Meld" wordmark at 14 px medium with -0.014em tracking', () => {
    render(<BrandMark />);
    const wordmark = screen.getByText('Meld');
    expect(wordmark.className).toContain('text-[14px]');
    expect(wordmark.className).toContain('font-medium');
    expect(wordmark.className).toContain('tracking-[-0.014em]');
  });
});
