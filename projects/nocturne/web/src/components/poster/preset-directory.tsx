import Link from 'next/link';
import type { ReactNode } from 'react';

import { PresetThumbnail } from '@/components/poster/preset-thumbnail';
import { PRESET_DIRECTORY } from '@/data/presets';

/**
 * The preset directory as real DOM (ADR-004 §2/§4) — the SEO-readable, screen-
 * reader-complete view of the field's looks. Rendered on the Tier-4 / no-JS
 * surface (over the poster) and reused on `/about`. Each preset = a designed
 * thumbnail + name + vibe. Server-renderable.
 */
export function PresetDirectory({
  heading = 'The presets',
  withCta = false,
}: {
  heading?: string;
  withCta?: boolean;
}): ReactNode {
  return (
    <section aria-label="Preset directory" className="w-full">
      <h2
        className="font-[family-name:var(--font-display)] font-medium"
        style={{
          color: 'var(--color-foreground)',
          fontSize: 'var(--text-2xl)',
          letterSpacing: 'var(--tracking-snug)',
        }}
      >
        {heading}
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PRESET_DIRECTORY.map((preset) => (
          <li
            key={preset.id}
            id={`preset-${preset.id}`}
            className="overflow-hidden rounded-[var(--radius-lg)] border"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
            }}
          >
            <PresetThumbnail presetId={preset.id} className="aspect-[16/9] w-full" />
            <div className="p-5">
              <h3
                className="font-[family-name:var(--font-display)] font-medium"
                style={{
                  color: 'var(--color-foreground)',
                  fontSize: 'var(--text-lg)',
                }}
              >
                {preset.name}
              </h3>
              <p className="mt-2 text-sm" style={{ color: 'var(--color-fg-muted)' }}>
                {preset.vibe}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {withCta ? (
        <p className="mt-8 text-sm">
          <Link
            href="/"
            className="underline-offset-4 hover:underline"
            style={{ color: 'var(--color-accent-ink)' }}
          >
            Enter the experience
          </Link>
        </p>
      ) : null}
    </section>
  );
}
