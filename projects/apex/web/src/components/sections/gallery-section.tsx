'use client';

import { useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';
import { ThemedImage } from './themed-image';

/**
 * Gallery / brand-story (Task 5.2) — the cinematic connective tissue.
 *
 * The wow-supporting scroll moment, judged against Olivier Larose + Stripe:
 *   - DESKTOP (`gsap.matchMedia` `(min-width: 768px)` + no-reduced-motion): a
 *     deliberate scroll-reveal sequence — each frame's image is revealed by a
 *     MASKED clip-path wipe (the configurator/track-line masked-reveal motif),
 *     its inner image PARALLAXES against the scroll (a slow `yPercent` scrub),
 *     and the copy slides up + fades in. Transform/clip-path/opacity only.
 *   - MOBILE: a vertical, snap-scrolling (`snap-y snap-mandatory`), lazy-loaded
 *     stack — NO parallax, NO scrubbed choreography (battery + budget), the
 *     reveals resolve to static. The markup is identical; only the motion
 *     differs.
 *   - `prefers-reduced-motion` (any width): reveals resolve to static (no wipe,
 *     no parallax) — the content is real DOM at full opacity in the markup, so a
 *     no-JS / reduced-motion user always sees every frame complete.
 *
 * Motion is GSAP only (ADR-002 boundary; no Motion). All imagery is `next/image`
 * AVIF via `ThemedImage` (art-directed `sizes`, theme-aware light/dark crops);
 * the first frame is eager-ish but below the fold, the rest lazy. LCP/CLS-safe:
 * every frame box is aspect-locked and reserved.
 */

interface Frame {
  readonly name: string;
  readonly aspect: string;
  readonly sizes: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  /** Editorial alignment of the copy panel on desktop. */
  readonly align: 'start' | 'end';
  /**
   * Per-aspect parallax drift in `yPercent` (the inner image travels
   * `-parallax -> +parallax` across the scroll). A taller frame has vertical
   * room for more drift before an edge shows; a wide/short frame reads almost
   * nothing at the fixed 8% (A-18), so the wide frames get a larger drift and the
   * inner scale is computed to cover `2*parallax` plus a safety margin.
   */
  readonly parallax: number;
}

/** Inner-image scale that guarantees the `2*parallax` drift never reveals an
 * edge (the image fills its parent at `object-cover`, so the extra scale is the
 * drift fraction on each side + a small safety margin). */
function coverScale(parallax: number): number {
  return 1 + (parallax / 100) * 2 + 0.04;
}

const FRAMES: readonly Frame[] = [
  {
    name: 'hero-3q',
    aspect: 'aspect-[16/9]',
    sizes: '(min-width: 768px) 70vw, 100vw',
    eyebrow: 'The flagship',
    title: 'Presence, before it moves',
    body: 'A full-size luxury stance, lit in the studio the way you will see it on the configurator. This is the exact car you shape and reserve.',
    align: 'start',
    parallax: 14,
  },
  {
    name: 'wheel-detail',
    aspect: 'aspect-[4/5]',
    sizes: '(min-width: 768px) 44vw, 100vw',
    eyebrow: 'Down to the wheels',
    title: 'Forged, machined, yours',
    body: 'Three wheel finishes, rendered live as you choose them — polished, graphite, or the signature voltaic tint. Configure it the way you would buy it.',
    align: 'end',
    parallax: 9,
  },
  {
    name: 'profile',
    aspect: 'aspect-[16/10]',
    sizes: '(min-width: 768px) 44vw, 100vw',
    eyebrow: 'Every line considered',
    title: 'A profile that reads premium',
    body: 'The same studio, the same lighting, the same car — turned to its side so the proportions and the paint can speak for themselves.',
    align: 'start',
    parallax: 13,
  },
  {
    name: 'rear-3q',
    aspect: 'aspect-[16/9]',
    sizes: '(min-width: 768px) 70vw, 100vw',
    eyebrow: 'From every angle',
    title: 'Built to be looked at',
    body: 'Reserve the precise configuration you built — paint, wheels and stance, captured in the same studio you configured it in.',
    align: 'end',
    parallax: 14,
  },
];

export function GallerySection(): ReactNode {
  const scope = useRef<HTMLElement>(null);

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const root = scope.current;
      if (!root) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          desktop: '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
          // Mobile or reduced-motion: static (no registration needed).
        },
        (ctx) => {
          if (!ctx.conditions?.desktop) return;

          const frames = root.querySelectorAll<HTMLElement>('[data-frame]');
          const cleanups: (() => void)[] = [];

          frames.forEach((frame) => {
            const mask = frame.querySelector<HTMLElement>('[data-frame-mask]');
            const img = frame.querySelector<HTMLElement>('[data-frame-img]');
            const copy = frame.querySelector<HTMLElement>('[data-frame-copy]');

            // Masked wipe reveal (clip-path inset) — the masked-reveal motif.
            if (mask) {
              gsap.set(mask, {
                clipPath: 'inset(0% 0% 100% 0%)',
                willChange: 'clip-path',
              });
              const wipe = gsap.to(mask, {
                clipPath: 'inset(0% 0% 0% 0%)',
                duration: 1,
                ease: 'power3.out',
                scrollTrigger: { trigger: frame, start: 'top 82%', once: true },
              });
              cleanups.push(() => {
                wipe.scrollTrigger?.kill();
                wipe.kill();
                gsap.set(mask, { clearProps: 'willChange' });
              });
            }

            // Parallax — the inner image drifts slower than the scroll. The
            // drift amount is per-aspect (A-18): a wide/short frame reads almost
            // nothing at a fixed 8%, so each frame carries its own range in
            // `data-parallax` and the inner scale already covers `2*range`.
            if (img) {
              const range = Number(img.dataset.parallax ?? '8') || 8;
              gsap.set(img, { willChange: 'transform' });
              const par = gsap.fromTo(
                img,
                { yPercent: -range },
                {
                  yPercent: range,
                  ease: 'none',
                  scrollTrigger: {
                    trigger: frame,
                    start: 'top bottom',
                    end: 'bottom top',
                    scrub: true,
                  },
                },
              );
              cleanups.push(() => {
                par.scrollTrigger?.kill();
                par.kill();
                gsap.set(img, { clearProps: 'willChange' });
              });
            }

            // Copy slides up + fades in.
            if (copy) {
              gsap.set(copy, { opacity: 0, y: 24, willChange: 'transform, opacity' });
              const intro = gsap.to(copy, {
                opacity: 1,
                y: 0,
                duration: 0.8,
                ease: 'power3.out',
                scrollTrigger: { trigger: frame, start: 'top 78%', once: true },
              });
              cleanups.push(() => {
                intro.scrollTrigger?.kill();
                intro.kill();
                gsap.set(copy, { clearProps: 'willChange' });
              });
            }
          });

          return () => {
            cleanups.forEach((fn) => { fn(); });
          };
        },
      );
    },
    [],
  );

  return (
    <section
      ref={scope}
      id="gallery"
      aria-labelledby="gallery-heading"
      className="bg-background relative scroll-mt-[var(--header-height,4rem)]"
    >
      <div className="mx-auto max-w-[var(--width-content,80rem)] px-[var(--space-gutter,1.25rem)] py-[var(--space-section,6rem)]">
        <div className="max-w-2xl">
          <p className="text-accent-ink text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
            The flagship, in studio
          </p>
          <h2
            id="gallery-heading"
            className="font-display text-foreground mt-3 text-[length:var(--text-3xl)] leading-[var(--leading-snug)] font-semibold tracking-[var(--tracking-tight)] text-balance"
          >
            The car you configure, from every angle
          </h2>
        </div>

        {/* The sequence. On mobile it is a vertical snap-scrolling stack; on
            desktop the frames lay out as an editorial column the GSAP sequence
            choreographs. */}
        <div className="mt-12 flex snap-y snap-mandatory flex-col gap-16 sm:snap-none sm:gap-24 lg:gap-32">
          {FRAMES.map((frame, i) => (
            <article
              key={frame.name}
              data-frame
              className={cn(
                'grid snap-center items-center gap-6 md:grid-cols-12 md:gap-10',
              )}
            >
              {/* Image — masked-reveal wrapper holds the parallaxing inner. */}
              <div
                className={cn(
                  'md:col-span-7',
                  frame.align === 'end' ? 'md:order-2 md:col-start-6' : '',
                )}
              >
                <div
                  data-frame-mask
                  className={cn(
                    'border-border bg-surface relative w-full overflow-hidden rounded-[var(--radius-xl)] border shadow-[var(--shadow-card)]',
                    frame.aspect,
                  )}
                >
                  {/* Inner is scaled to cover the per-aspect parallax drift so
                      the shift never reveals an edge (A-18). */}
                  <div
                    data-frame-img
                    data-parallax={frame.parallax}
                    className="absolute inset-0"
                    style={{ scale: String(coverScale(frame.parallax)) }}
                  >
                    <ThemedImage
                      lightSrc={`/gallery/${frame.name}.avif`}
                      alt={`${frame.title} — APEX studio render`}
                      sizes={frame.sizes}
                      fit="object-cover"
                      priority={false}
                    />
                  </div>
                </div>
              </div>

              {/* Copy. */}
              <div
                data-frame-copy
                className={cn(
                  'md:col-span-5',
                  frame.align === 'end'
                    ? 'md:order-1 md:col-start-1'
                    : 'md:col-start-8',
                )}
              >
                <p className="text-fg-subtle text-[length:var(--text-xs)] font-medium tracking-[var(--tracking-wider)] uppercase">
                  {frame.eyebrow}
                </p>
                <h3 className="font-display text-foreground mt-3 text-[length:var(--text-2xl)] font-semibold tracking-[var(--tracking-tight)] text-balance">
                  {frame.title}
                </h3>
                <p className="text-fg-muted mt-4 max-w-md text-[length:var(--text-base)] leading-[var(--leading-normal)] text-balance">
                  {frame.body}
                </p>
                <span
                  aria-hidden="true"
                  className="mt-6 block h-px w-24"
                  style={{ background: 'var(--gradient-track)' }}
                />
                <span className="sr-only">Frame {i + 1} of {FRAMES.length}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
