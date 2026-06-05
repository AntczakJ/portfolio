'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useThemeClass } from '@/lib/use-theme-class';

interface ThemedImageProps {
  /** The light-register source path. The dark source is derived (see below). */
  lightSrc: string;
  /**
   * The dark-register source. If omitted it is derived by inserting `-dark`
   * before the extension (e.g. `/x/hero.avif` -> `/x/hero-dark.avif`), matching
   * the section-asset generator's convention.
   */
  darkSrc?: string;
  alt: string;
  sizes: string;
  className?: string;
  /** Object fit class (default `object-cover`). */
  fit?: string;
  /** Blur placeholders by theme (CLS-safe; defaults to none). */
  blurDataURL?: string;
  blurDataURLDark?: string;
  priority?: boolean;
}

/** Insert `-dark` before the file extension. */
function deriveDark(src: string): string {
  const dot = src.lastIndexOf('.');
  if (dot === -1) return `${src}-dark`;
  return `${src.slice(0, dot)}-dark${src.slice(dot)}`;
}

/**
 * Theme-aware `next/image` (Phase 5) — swaps the AVIF source between the light
 * and the dark "night drive" re-key as the theme changes, using the same
 * `html.dark` observer pattern as the configurator stage (via `useThemeClass`).
 *
 * SSR default = LIGHT (the canonical default, ADR-001), so the server and the
 * first client render agree (no hydration mismatch); the dark swap is a
 * post-mount state update. `key={src}` forces a clean crop+blur swap on a theme
 * toggle. Fills its (reserved, aspect-locked) parent — the parent must be
 * `relative` and size-reserved so there is no CLS.
 */
export function ThemedImage({
  lightSrc,
  darkSrc,
  alt,
  sizes,
  className,
  fit = 'object-cover',
  blurDataURL,
  blurDataURLDark,
  priority = false,
}: ThemedImageProps): ReactNode {
  const theme = useThemeClass();
  const src = theme === 'dark' ? (darkSrc ?? deriveDark(lightSrc)) : lightSrc;
  const blur = theme === 'dark' ? (blurDataURLDark ?? blurDataURL) : blurDataURL;

  return (
    <Image
      key={src}
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      placeholder={blur ? 'blur' : 'empty'}
      {...(blur ? { blurDataURL: blur } : {})}
      className={cn(fit, className)}
    />
  );
}
