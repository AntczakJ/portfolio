import type { ReactNode } from 'react';

import { TrackLine } from '@/components/chrome/track-line';
import { HERO_BLUR_DATA_URL } from '@/components/hero/hero-assets';
import {
  CONFIGURATOR_OPTIONS,
  DEFAULT_CONFIG,
  getRenderStill,
  HERO_VEHICLE,
} from '@/mocks';
import { RESERVE_HREF } from '@/lib/site-nav';
import Image from 'next/image';

import { ConfiguratorStage } from './configurator-stage';
import { ConfiguratorControls } from './configurator-controls';

/**
 * The configurator section (Task 4.3 / 4.4) — the wow centrepiece.
 *
 * A SERVER component (the low `'use client'` boundary, ADR-002 §2): it renders
 * the heading, copy, the reserved stage box, and — crucially — the TIER-4 floor
 * (the default-configuration static still with real `alt` text + a real
 * `<a href="/reserve?…">` link), so the section reads completely without JS or
 * WebGL and is crawlable. Two client islands enhance it:
 *
 *   - `<ConfiguratorStage />` — the four-tier display gate (live R3F canvas on
 *     Tier 1/2; the pre-baked still on Tier 3; the reveal-when-ready crossfade).
 *     It mounts INTO the reserved stage box (CLS-safe), absolutely positioned
 *     over the Tier-4 floor still it then supersedes.
 *   - `<ConfiguratorControls />` — the accessible DOM radio-group swatch controls
 *     + the debounced `aria-live` text alternative + the "Reserve this
 *     configuration" carry-over CTA. Identical DOM across all tiers.
 *
 * The seam (ADR-004): the hero hands off into this section. The hero's own
 * reserved seam-mount box also receives a live canvas in the Tier-1 path, but
 * this section is the configurator's permanent home — the static still here is
 * pose-matched to the hero render (same rig framing) so the scroll from hero to
 * configurator reads as one continuous "one car, brought closer" move.
 */
export function ConfiguratorSection(): ReactNode {
  const stillSrc =
    getRenderStill(DEFAULT_CONFIG.colorId, DEFAULT_CONFIG.wheelId) ??
    HERO_VEHICLE.heroRenderSrc;
  const color = CONFIGURATOR_OPTIONS.colors.find(
    (c) => c.id === DEFAULT_CONFIG.colorId,
  );
  const wheel = CONFIGURATOR_OPTIONS.wheels.find(
    (w) => w.id === DEFAULT_CONFIG.wheelId,
  );
  const configText = `${HERO_VEHICLE.name}, ${color?.name ?? 'default finish'}, ${
    wheel?.name ?? 'standard wheels'
  }`;

  return (
    <section
      id="configurator"
      aria-labelledby="configurator-heading"
      className="bg-background relative"
    >
      {/* Art-directed hero -> configurator transition (D-08): a vertical
          track-line connector descends from the section top, continuing the
          hero's descending scroll-charge so the scroll reads as one continuous
          "one car, brought closer" move rather than a jump to a separate
          section. Decorative; the global reduced-motion floor stills the charge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 z-0 h-[var(--space-section,6rem)] w-px -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-[var(--color-track)]"
      >
        <span className="apex-scroll-charge bg-accent absolute inset-x-0 top-0 h-4" />
      </div>

      <div className="mx-auto max-w-[var(--width-content,80rem)] px-[var(--space-gutter,1.25rem)] py-[var(--space-section,6rem)]">
        <div className="max-w-2xl">
          <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
            Make it yours
          </p>
          <h2
            id="configurator-heading"
            className="font-display text-foreground mt-3 text-[length:var(--text-3xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance"
          >
            {/* Keep the model name from orphaning on a line of its own (D-12):
                the verb phrase may wrap, but "APEX Lumen SUV" stays whole. */}
            Configure the{' '}
            <span className="whitespace-nowrap">{HERO_VEHICLE.name}</span>
          </h2>
          <p className="text-fg-muted mt-4 text-[length:var(--text-lg)] text-balance">
            Spin it, change the paint and wheels, and reserve the exact car you
            built.
          </p>
        </div>

        <TrackLine className="my-10" />

        {/* ===== SEAM TARGET (ADR-004) ======================================
            The reserved configurator stage (aspect-locked so the canvas / still
            mount without CLS). The Tier-4 floor — the default-config still with
            real alt text — is the SERVER-rendered base; the client
            <ConfiguratorStage /> absolutely overlays it (live canvas on
            Tier 1/2, the per-selection still on Tier 3) once hydrated.
            ================================================================= */}
        <div
          data-configurator-stage
          className="border-border bg-surface relative aspect-[5/6] w-full overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-studio)] sm:aspect-[4/3] lg:aspect-[3/2]"
        >
          {/* Tier-4 floor: default-config still (server-rendered; superseded by
              the stage after hydration). */}
          <Image
            src={stillSrc}
            alt={`${configText} — APEX studio render`}
            fill
            loading="lazy"
            sizes="(min-width: 1024px) 80vw, 100vw"
            placeholder="blur"
            blurDataURL={HERO_BLUR_DATA_URL}
            className="object-cover object-center sm:object-contain"
          />
          {/* The client four-tier stage overlay. */}
          <ConfiguratorStage />
        </div>

        {/* The accessible controls + text alternative + carry-over CTA (client;
            identical DOM across all tiers). The Tier-4 no-JS floor link below it
            is the static fallback for when this client island has not hydrated. */}
        <ConfiguratorControls />

        {/* Tier-4 no-JS floor: a real reserve link with the default config.
            Hidden once JS runs (the client controls carry the live CTA). */}
        <noscript>
          <div className="mt-6">
            <a
              href={`${RESERVE_HREF}?vehicle=${HERO_VEHICLE.slug}&color=${DEFAULT_CONFIG.colorId}&wheels=${DEFAULT_CONFIG.wheelId}`}
              className="bg-accent text-accent-contrast inline-flex h-12 items-center rounded-md px-7 text-base font-medium"
            >
              Reserve this configuration
            </a>
          </div>
        </noscript>
      </div>
    </section>
  );
}
