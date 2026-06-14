import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PresetDirectory } from '@/components/poster/preset-directory';
import { SITE_NAME, SITE_URL } from '@/lib/site-config';

/**
 * `/about` — the clean, light-readable NON-canvas surface (Task 5.3).
 *
 * This is the Lighthouse-≥95 surface + the SEO / screen-reader view of the
 * piece: the technique in accessible prose, the PRESET DIRECTORY (the same data
 * as the Tier-4 no-JS directory), the CREDITS (fonts + the procedurally-
 * synthesized audio note + libraries), and the ACCESSIBILITY STATEMENT (reduced-
 * motion behaviour, the canvas text alternative, keyboard operation). Rendered
 * entirely server-side; no canvas. Carries a CreativeWork + Person JSON-LD.
 */
export const metadata: Metadata = {
  title: 'About',
  description:
    'How NOCTURNE works — a GPGPU curl-noise particle field driven by a Web Audio FFT — its preset directory, credits, and accessibility statement.',
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'article',
    url: '/about',
    title: `About — ${SITE_NAME}`,
    description:
      'How NOCTURNE works — a GPGPU curl-noise particle field driven by a Web Audio FFT — its presets, credits, and accessibility statement.',
    // Reuse the designed root OG image (the wordmark over the field motif).
    images: ['/opengraph-image'],
  },
};

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'CreativeWork',
  name: 'NOCTURNE',
  url: SITE_URL,
  description:
    'A GPU audio-reactive generative particle field: hundreds of thousands of particles advected through a curl-noise vector field, computed on the GPU and reacting in real time to sound.',
  genre: 'Generative art',
  keywords: 'WebGL, GPGPU, curl noise, audio reactive, creative coding',
  author: {
    '@type': 'Person',
    name: 'Jan Antczak',
  },
  inLanguage: 'en',
} as const;

export default function AboutPage(): ReactNode {
  return (
    <main
      id="main"
      className="mx-auto w-full max-w-[var(--width-content)] px-[var(--space-gutter)] py-[var(--space-section)]"
    >
      <script
        type="application/ld+json"
        // JSON-LD is a static, app-authored object — safe to inline.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(aboutJsonLd) }}
      />

      <p
        className="text-xs uppercase"
        style={{
          color: 'var(--color-fg-muted)',
          letterSpacing: 'var(--tracking-wider)',
        }}
      >
        About
      </p>
      <h1
        className="mt-3 font-[family-name:var(--font-display)] font-semibold"
        style={{
          color: 'var(--color-foreground)',
          fontSize: 'var(--text-4xl)',
          lineHeight: 'var(--leading-tight)',
          letterSpacing: 'var(--tracking-snug)',
        }}
      >
        NOCTURNE
      </h1>

      <div
        className="mt-6 max-w-prose space-y-4 text-base"
        style={{ color: 'var(--color-fg-muted)' }}
      >
        <p>
          NOCTURNE is a generative particle experience: hundreds of thousands of
          particles flow through an animated curl-noise vector field, computed
          entirely on the GPU, and react in real time to sound, the pointer, and
          a set of curated presets — finished with cinematic bloom, vignette, and
          a subtle chromatic aberration.
        </p>
      </div>

      <Section heading="The technique">
        <p>
          The simulation runs as a <Term>GPGPU ping-pong</Term>. Each particle&apos;s
          position and velocity live in floating-point textures. Every frame a
          hand-written GLSL shader reads the current textures and writes the next
          ones into an off-screen framebuffer, with the read and write targets
          swapping (&ldquo;ping-ponging&rdquo;) so the GPU never reads and writes
          the same texture in one pass. The whole simulation runs on the GPU; the
          CPU only sets a handful of values per frame, which is what lets the
          field hold hundreds of thousands of particles at 60&nbsp;frames per
          second.
        </p>
        <p>
          Motion comes from <Term>curl noise</Term> — the velocity update samples
          the curl of a 3D noise field. Because the curl of a vector field is
          divergence-free, particles flow in smooth, swirling, incompressible
          streams rather than scattering or collapsing. Flow scale, speed, and
          turbulence are live parameters, which is exactly what the audio and the
          presets drive.
        </p>
        <p>
          The field breathes with sound through a <Term>Web Audio FFT</Term>. An
          analyser produces a frequency spectrum each frame, reduced to a few
          bands plus an overall energy envelope and smoothed with an attack/
          release curve so the visuals pulse musically rather than strobe. Bass
          surges the turbulence, mids open the field&apos;s spread, highs shimmer
          the colour, and overall loudness blooms the glow — so the field
          brightens and swells on the beat.
        </p>
      </Section>

      <Section heading="The presets">
        <p className="mb-6">
          One engine, many looks. Switching a preset cross-fades the entire
          parameter set — palette, flow, particle treatment, and post-processing
          — so the field morphs from one identity to another in front of you.
        </p>
        <PresetDirectory heading="" />
      </Section>

      <Section heading="Credits">
        <ul className="space-y-2">
          <li>
            <strong style={{ color: 'var(--color-foreground)' }}>Type.</strong>{' '}
            Sora and Outfit, both licensed under the SIL Open Font License 1.1,
            self-hosted at build time.
          </li>
          <li>
            <strong style={{ color: 'var(--color-foreground)' }}>Audio.</strong>{' '}
            The built-in track is <em>procedurally synthesized</em> in the
            browser with the Web Audio API — an evolving pad, a shimmer layer,
            and a rhythmic pulse. There is no third-party recording to license.
            You can also drive the field from your microphone or your own audio
            file; uploaded audio is decoded and played entirely in your browser
            and never leaves your device.
          </li>
          <li>
            <strong style={{ color: 'var(--color-foreground)' }}>Libraries.</strong>{' '}
            React Three Fiber, drei, and @react-three/postprocessing on top of
            three.js — all MIT-licensed.
          </li>
        </ul>
      </Section>

      <Section heading="Accessibility">
        <ul className="space-y-2">
          <li>
            The animated canvas is <Term>decorative</Term> (
            <code>aria-hidden</code>). A live text description announces what the
            field is and what it is reacting to, so the meaning is available
            without the visuals.
          </li>
          <li>
            <Term>Reduced motion</Term> is respected. If your system requests
            reduced motion, the field drifts calmly with audio reactivity muted —
            nothing strobes and audio never autoplays — and a &ldquo;Still&rdquo;
            control freezes a composed frame entirely.
          </li>
          <li>
            Every control is real, <Term>keyboard-operable</Term> DOM with visible
            focus: the begin gate, the preset radio-group (arrow keys), the audio
            source picker, mute, motion mode, pointer interaction, fullscreen, and
            the chrome theme. The HUD dims after inactivity but never leaves the
            keyboard tab order, and returns the moment a control is focused.
          </li>
          <li>
            If WebGL or floating-point textures are unavailable, the piece falls
            back to a composed still and this readable directory of presets.
          </li>
        </ul>
      </Section>

      <p className="mt-[var(--space-section)] flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link
          href="/"
          className="underline-offset-4 hover:underline"
          style={{ color: 'var(--color-accent-ink)' }}
        >
          Enter the experience
        </Link>
      </p>
    </main>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section className="mt-[var(--space-section)]">
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
      <div
        className="mt-6 max-w-prose space-y-4 text-base"
        style={{ color: 'var(--color-fg-muted)' }}
      >
        {children}
      </div>
    </section>
  );
}

function Term({ children }: { children: ReactNode }): ReactNode {
  return <strong style={{ color: 'var(--color-foreground)' }}>{children}</strong>;
}
