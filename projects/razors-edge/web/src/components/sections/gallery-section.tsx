'use client';

import Image from 'next/image';
import { useRef, type ReactNode } from 'react';

import { useGsapEffect } from '@/lib/gsap/use-gsap-effect';
import type { GallerySlot } from '@/mocks';
import { GALLERY_FRAMES } from '@/mocks';

/**
 * Gallery (Task 4.2) — horizontal pinned scroll on desktop (ADR-003 cross-
 * reference / PLAN.md), a vertical scroll-snap stack on touch + reduced
 * motion.
 *
 * Desktop (pointer + no-preference, ≥ 1024px): the section pins for the
 * length of the horizontal track and the strip translates left as the
 * viewer scrolls down — GSAP `ScrollTrigger` pin + scrub (ADR-002: all
 * scroll = GSAP, transform-only, rAF-driven). Each frame parallaxes its
 * image inside its frame at a gentler rate than the track for cinematic
 * depth (Olivier Larose's photographic art direction is the bar). The
 * caption rises as the frame enters centre.
 *
 * Reduced motion OR touch OR < 1024px: NO pin, NO horizontal scrub — the
 * strip is a vertical, scroll-snap, lazy-loaded stack (the mobile-first,
 * keyboard-and-swipe-usable fallback the accessibility caveat requires).
 * The same DOM serves both; only the GSAP layer differs, so there is never
 * a keyboard-trap horizontal scroll.
 *
 * All images are `next/image` (AVIF via next.config), sized, with blur
 * placeholders; below-the-fold so none are `priority` (the hero portrait
 * keeps the LCP). The reveal mid-frame is always a composition (every
 * intermediate scrub frame holds — the designer-critic's recurring rule).
 */
export function GallerySection(): ReactNode {
  const scope = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLUListElement>(null);

  useGsapEffect(
    scope,
    ({ gsap }) => {
      const root = scope.current;
      const track = trackRef.current;
      if (!root || !track) return;

      const mm = gsap.matchMedia();

      // Desktop, motion OK, fine pointer → the pinned horizontal scrub.
      mm.add(
        '(min-width: 1024px) and (prefers-reduced-motion: no-preference) and (pointer: fine)',
        () => {
          const frames = gsap.utils.toArray<HTMLElement>(
            track.querySelectorAll('[data-gallery-frame]'),
          );

          // Distance the track must travel: its overflow past the viewport.
          const getDistance = () =>
            Math.max(0, track.scrollWidth - root.clientWidth);

          const tween = gsap.to(track, {
            x: () => -getDistance(),
            ease: 'none',
            scrollTrigger: {
              trigger: root,
              start: 'top top',
              end: () => `+=${String(getDistance())}`,
              pin: true,
              scrub: 1,
              invalidateOnRefresh: true,
              anticipatePin: 1,
            },
          });

          // Per-image parallax inside each frame, tied to the same scrub —
          // the image drifts opposite the track for depth (cinematic).
          frames.forEach((frame) => {
            const img = frame.querySelector<HTMLElement>('[data-gallery-img]');
            if (!img) return;
            gsap.fromTo(
              img,
              { xPercent: -8 },
              {
                xPercent: 8,
                ease: 'none',
                scrollTrigger: {
                  trigger: frame,
                  containerAnimation: tween,
                  start: 'left right',
                  end: 'right left',
                  scrub: true,
                },
              },
            );
          });

          return () => {
            tween.scrollTrigger?.kill();
            tween.kill();
          };
        },
      );

      // No isolated `ScrollTrigger.refresh()` here: `useGsapEffect` requests a
      // single coordinated global refresh after the last section (incl. the
      // idle-deferred hero pin) has registered, so this pinned trigger is
      // always measured against a document that includes every upstream pin.
    },
    [],
  );

  return (
    <section
      ref={scope}
      id="gallery"
      aria-labelledby="gallery-heading"
      className="relative scroll-mt-24 overflow-hidden py-24 sm:py-28 lg:py-0"
    >
      {/* Heading rail — sits above the strip on touch/mobile, overlays as a
          fixed corner label inside the pinned viewport on desktop. */}
      <div className="mx-auto mb-12 max-w-[80rem] px-5 sm:px-8 lg:absolute lg:top-10 lg:left-0 lg:right-0 lg:z-10 lg:mb-0">
        <p className="text-brass-text flex items-center gap-3 text-[length:var(--text-caption)] tracking-[0.32em] uppercase">
          <span
            aria-hidden="true"
            className="h-px w-8 bg-[var(--color-edge-glow)]"
          />
          The work
        </p>
        <h2
          id="gallery-heading"
          className="font-display text-fg mt-4 max-w-xl text-balance text-[length:var(--text-h1)] leading-[1.05] [font-variation-settings:'opsz'_120,'wght'_440,'SOFT'_0]"
        >
          A room, a chair, and the result.
        </h2>
      </div>

      {/*
        The strip. On desktop it is a single flex row the size of its
        content, pinned + scrubbed horizontally. On touch/mobile/reduced it
        is a vertical scroll-snap column. The Tailwind classes encode the
        layout split; GSAP only adds the desktop pin/scrub on top.
      */}
      <ul
        ref={trackRef}
        className="flex flex-col gap-6 px-5 sm:px-8 lg:h-dvh lg:flex-row lg:items-center lg:gap-10 lg:px-[8vw] lg:pl-[max(8vw,12rem)] [&>li]:snap-center max-lg:snap-y max-lg:snap-mandatory"
      >
        {GALLERY_FRAMES.map((frame, i) => (
          <li
            key={frame.slot}
            data-gallery-frame
            className="lg:shrink-0"
          >
            <GalleryFrame frame={frame} index={i} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One gallery frame. The image is clipped in a fixed-aspect container so the
 * desktop parallax (image wider than its frame, drifting inside) never
 * reveals an edge. A brass hairline + caption sit beneath. Sizes are tuned
 * for the desktop strip height; on mobile the frame fills the column width.
 */
function GalleryFrame({
  frame,
  index,
}: {
  frame: GallerySlot;
  index: number;
}): ReactNode {
  // Vary the desktop frame width a touch so the strip has editorial rhythm
  // rather than a uniform contact sheet.
  const widthClass =
    index % 3 === 0
      ? 'lg:w-[34rem]'
      : index % 3 === 1
        ? 'lg:w-[26rem]'
        : 'lg:w-[30rem]';

  return (
    <figure className={widthClass}>
      <div
        className="border-border/60 relative w-full overflow-hidden rounded-sm border lg:h-[64vh]"
        style={{ aspectRatio: String(frame.aspectRatio) }}
      >
        {/* The image is overscaled so the desktop parallax drift inside the
            frame never exposes an edge (xPercent ±8 on a 116% box). */}
        <div data-gallery-img className="absolute inset-0 lg:scale-[1.16]">
          <Image
            src={frame.src}
            alt={frame.alt}
            fill
            sizes="(min-width: 1024px) 34rem, 100vw"
            placeholder="blur"
            blurDataURL={frame.blurDataURL}
            className="object-cover"
          />
        </div>
        {/* Bottom vignette so the caption sits legibly over the photo edge. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent"
        />
      </div>
      {frame.caption ? (
        <figcaption className="mt-4 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="h-px w-6 bg-[var(--color-edge-glow)]"
          />
          <span className="text-fg-muted text-sm tracking-wide">
            {frame.caption}
          </span>
        </figcaption>
      ) : null}
    </figure>
  );
}
