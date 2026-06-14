import Link from 'next/link';
import type { ReactNode } from 'react';

import { PresetDirectory } from '@/components/poster/preset-directory';
import { Stage } from '@/components/stage/stage';
import { DEFAULT_PRESET_ID, getPresetOrDefault } from '@/data/presets';
import { describeFieldState } from '@/lib/hud/describe-state';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site-config';

/**
 * WebSite + Person JSON-LD for `/` (the SEO surface). Static, app-authored.
 */
const homeJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: 'en',
      creator: { '@id': `${SITE_URL}/#person` },
    },
    {
      '@type': 'Person',
      '@id': `${SITE_URL}/#person`,
      name: 'Jan Antczak',
      jobTitle: 'Frontend & creative engineer',
    },
    {
      '@type': 'CreativeWork',
      '@id': `${SITE_URL}/#work`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      genre: 'Generative art',
      author: { '@id': `${SITE_URL}/#person` },
    },
  ],
} as const;

/**
 * `/` — the immersive canvas route (Pass 3).
 *
 * A Server Component that renders:
 *   1. the live-canvas STAGE (a low `'use client'` island) — poster → field →
 *      cinematic HUD, plus the `aria-live` text alternative;
 *   2. a complete REAL-DOM fallback (`#nojs-fallback`) — the wordmark, the
 *      positioning, the full preset directory, and the about link — which is the
 *      Tier-4 / no-JS / crawler / screen-reader floor. It is server-rendered into
 *      the HTML so the page reads and is indexable with WebGL or JS off; the
 *      client island hides it (`[data-armed]`) once the live experience mounts.
 *
 * The canvas itself is `aria-hidden` decorative (inside `<Stage>`); the meaning
 * lives in this DOM + the `aria-live` description (ADR-004 §5).
 */
export default function HomePage(): ReactNode {
  const defaultPreset = getPresetOrDefault(DEFAULT_PRESET_ID);
  const fallbackDescription = describeFieldState({
    presetName: defaultPreset.name,
    source: 'builtin',
    route: 'poster',
    armed: false,
    muted: false,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd) }}
      />
      <Stage />

      {/* The no-JS / Tier-4 / crawler floor. The Stage hides this once the live
          experience mounts (it adds `data-armed` to <html>), so JS+WebGL users
          see the field, not this; everyone else gets a complete readable page. */}
      <main
        id="main"
        data-nojs-fallback
        className="relative min-h-dvh"
      >
        <section className="flex min-h-dvh flex-col items-center justify-center px-6 py-24 text-center">
          <div className="hud-scrim max-w-2xl rounded-2xl px-8 py-10">
            <p
              className="text-xs uppercase"
              style={{
                color: 'var(--color-fg-muted)',
                letterSpacing: 'var(--tracking-wider)',
              }}
            >
              A GPU audio-reactive field
            </p>
            <h1
              className="mt-4 font-[family-name:var(--font-display)] font-semibold"
              style={{
                color: 'var(--hud-ink)',
                fontSize: 'var(--text-6xl)',
                lineHeight: 'var(--leading-tight)',
                letterSpacing: 'var(--tracking-wider)',
              }}
            >
              NOCTURNE
            </h1>
            <p
              className="mx-auto mt-6 max-w-prose text-base"
              style={{ color: 'var(--color-fg-muted)' }}
            >
              {SITE_DESCRIPTION}
            </p>
            <p className="sr-only">{fallbackDescription}</p>
            <p className="mt-8 text-sm">
              <Link
                href="/about"
                className="underline-offset-4 hover:underline"
                style={{ color: 'var(--color-accent-ink)' }}
              >
                Read about the technique and accessibility
              </Link>
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[var(--width-content)] px-[var(--space-gutter)] pb-[var(--space-section)]">
          <PresetDirectory heading="The presets" />
        </section>
      </main>
    </>
  );
}
