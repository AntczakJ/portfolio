'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Poster } from '@/components/poster/poster';
import { getPresetOrDefault } from '@/data/presets';
import { detectGpuTier, forceTierConfig } from '@/lib/engine/detect-gpu-tier';
import {
  defaultMotionMode,
  isAudioReactive,
  isCapabilityFloor,
  isPointerWakeActive,
  resolveRenderRoute,
  shouldRunLoop,
} from '@/lib/engine/routing';
import { describeFieldState } from '@/lib/hud/describe-state';
import { useExperienceStore } from '@/lib/store/experience-store';
import type { RenderRoute, TierConfig } from '@/lib/schemas';

import { FieldCanvas } from './field-canvas';
import { HardwareHint } from './hardware-hint';
import { Hud } from './hud';
import { IntroOverlay } from './intro-overlay';
import { useAudioEngine } from './use-audio-engine';
import { useTabVisibility } from './use-tab-visibility';

/**
 * The `/` stage shell (ADR-002 §5 / ADR-004 §3) — Pass 3: the live engine, the
 * cinematic gesture gate, the auto-dimming HUD, the poster→live reveal seam, and
 * the `aria-live` text alternative.
 *
 * Layer model (one reserved fullscreen box, back to front):
 *   1. the DESIGNED poster still (the LCP; the Tier-4 / pre-reveal surface);
 *   2. the live R3F field (lazy `ssr:false`) — mounted on a non-poster route,
 *      cross-faded in on first-frame-ready (`fieldReady`);
 *   3. the intro gate (pre-arm) → the HUD (post-arm), all real keyboard DOM;
 *   4. the visually-hidden `aria-live` description of the current field state.
 *
 * The capability probe runs AFTER mount; until it resolves only the poster
 * shows (no empty-canvas flash). On the poster route the parent page's real-DOM
 * directory is the readable Tier-4 surface (this island renders only the still).
 */
export function Stage(): ReactNode {
  const [config, setConfig] = useState<TierConfig | null>(null);
  const [fieldReady, setFieldReady] = useState(false);

  const presetId = useExperienceStore((s) => s.presetId);
  const transitioningToId = useExperienceStore((s) => s.transitioningToId);
  const completePresetTransition = useExperienceStore(
    (s) => s.completePresetTransition,
  );
  const motionMode = useExperienceStore((s) => s.motionMode);
  const setMotionMode = useExperienceStore((s) => s.setMotionMode);
  const pointerInteraction = useExperienceStore((s) => s.pointerInteraction);
  const armState = useExperienceStore((s) => s.armState);
  const arm = useExperienceStore((s) => s.arm);
  const muted = useExperienceStore((s) => s.muted);

  const audio = useAudioEngine();
  const tabHidden = useTabVisibility();

  // capability probe after mount + adopt the default motion mode for the route
  useEffect(() => {
    const forced = new URLSearchParams(window.location.search).get('tier');
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const detected =
      forced === 'low' || forced === 'mid' || forced === 'high'
        ? forceTierConfig(forced, reducedMotion)
        : detectGpuTier();
    setConfig(detected);
    setMotionMode(defaultMotionMode(detected));
  }, [setMotionMode]);

  // keep the audio graph's mute in sync with the store
  useEffect(() => {
    audio.setMuted(muted);
  }, [muted, audio]);

  const route: RenderRoute = config
    ? resolveRenderRoute(config, motionMode)
    : 'poster';

  // The genuine CAPABILITY FLOOR (Tier 4: no WebGL2 / no float / software GL, or
  // the probe not yet resolved) — DISTINCT from a "Still" toggle on a capable
  // device. The Stage drives `data-armed` + the page-overflow lock off THIS, not
  // off the resolved `route`: live, calm, AND still-on-a-capable-device are all
  // the immersive fullscreen stage and must stay scroll-locked with the SSR
  // directory hidden. Only the real floor unlocks scroll + reveals the directory.
  const capabilityFloor = isCapabilityFloor(config);

  // On a capable device hide the SSR no-JS DOM fallback (the field + HUD are the
  // experience) and lock page overflow. At the capability floor (Tier 4) the SSR
  // directory STAYS visible + scrollable — it is the readable surface. The CSS
  // rule `[data-armed] [data-nojs-fallback] { display: none }` does the hiding.
  useEffect(() => {
    const root = document.documentElement;
    const { body } = document;
    if (capabilityFloor) {
      // Tier-4: the SSR directory is the readable surface — keep scroll, reveal
      // the directory (do NOT set `data-armed`).
      root.removeAttribute('data-armed');
      return;
    }
    root.setAttribute('data-armed', '');
    // The live / calm / still experience is a FIXED fullscreen stage (the field,
    // the intro gate, the HUD, and the frozen poster still are all `fixed` /
    // `absolute inset-0`), so the page never needs to scroll. Lock page overflow
    // while it is mounted: without this, a HiDPI device or a classic OS scrollbar
    // can introduce a sub-pixel horizontal overflow that lets the viewport pan
    // right and pulls the centred intro wordmark off-centre (the reported bug,
    // re-triggered by toggling Still when the lock keyed off the resolved route).
    // The poster FLOOR keeps its scroll, and `/about` is a separate route where
    // this island is unmounted (the cleanup restores the styles).
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      root.removeAttribute('data-armed');
      root.style.overflow = prevRootOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [capabilityFloor]);

  const showField = route !== 'poster';

  // When the field is not the live surface (the Still toggle unmounts it, or a
  // route flip to calm/poster), drop `fieldReady` so the poster bridges the gap
  // until the field re-mounts and reports its first frame again. Without this, a
  // Still→Full toggle would jump straight to a not-yet-rendered (black) field
  // instead of cross-fading the poster out over the freshly-ready field.
  useEffect(() => {
    if (!showField) setFieldReady(false);
  }, [showField]);

  const armed = armState === 'armed';
  const paused = !shouldRunLoop(route, armed, tabHidden);
  const audioReactive = config ? isAudioReactive(config, motionMode) : false;
  const pointerWake =
    config && pointerInteraction
      ? isPointerWakeActive(config, motionMode)
      : false;

  const onBegin = useCallback(async () => {
    await audio.arm();
    arm();
  }, [audio, arm]);

  const onReady = useCallback(() => {
    setFieldReady(true);
  }, []);

  // `showField` (declared above) mounts + animates the live field ONLY on the
  // live/calm route. On the Still route (resolved 'poster' but a CAPABLE config)
  // the field is deliberately UNMOUNTED — no render loop, no animation; that is
  // the point of Still.
  const revealed = fieldReady && armed;
  // The poster is the visible surface whenever the live field is NOT (pre-arm,
  // Still, and the capability floor all show the poster; only a live+revealed
  // field replaces it). On Still this keeps the FROZEN poster still visible —
  // never a blank stage — while the live reveal cross-fade on the live route is
  // unchanged (field fades in over the poster once `revealed`).
  const fieldIsVisibleSurface = showField && revealed;
  const posterVisible = !fieldIsVisibleSurface;

  const presetName = getPresetOrDefault(transitioningToId ?? presetId).name;
  const description = describeFieldState({
    presetName,
    source: audio.source,
    route,
    armed,
    muted,
  });

  return (
    <>
      {/* Stage ground + the reserved fullscreen box (CLS-safe), behind the page
          content (`-z-10`). The poster is the LCP; the field reveals over it. */}
      <div className="stage-ground fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0">
          {/* the designed poster — always present as the LCP/pre-reveal still */}
          <div
            className="absolute inset-0 transition-opacity duration-[1000ms] ease-out"
            style={{ opacity: posterVisible ? 1 : 0 }}
            aria-hidden
          >
            <Poster presetId={transitioningToId ?? presetId} />
          </div>
          {showField && config ? (
            <div
              className="absolute inset-0 transition-opacity duration-[1200ms] ease-out"
              style={{ opacity: revealed ? 1 : 0 }}
            >
              <FieldCanvas
                config={config}
                presetId={presetId}
                transitioningToId={transitioningToId}
                audioEngine={audio.engineRef.current}
                audioReactive={audioReactive}
                pointerWake={pointerWake}
                paused={paused}
                onReady={onReady}
                onTransitionComplete={completePresetTransition}
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* The aria-live text alternative — the screen-reader view of the
          decorative (aria-hidden) canvas (ADR-004 §5). */}
      <p aria-live="polite" className="sr-only">
        {description}
      </p>

      {/* The "enable hardware acceleration" hint (FIX 2) — ONLY when the probe
          routed to the poster because the renderer is SOFTWARE WebGL (a fixable
          setting). The ordinary no-WebGL / no-JS poster (no-webgl2 / no-float —
          a capability floor) gets no hint. */}
      {config?.posterReason === 'software-webgl' ? <HardwareHint /> : null}

      {/* The intro gate (pre-arm) → the HUD (post-arm), ABOVE the page content
          (`z-20`). The wrapper is click-through; its children opt back in. The
          HUD/gate mount on ANY capable route — live, calm, AND still — so the
          Still toggle freezes to the poster still with the HUD STILL present (it
          does not reset `armState`, so it never re-prompts "press to begin").
          Only the genuine capability floor unmounts it (the SSR directory + hint
          is that surface). */}
      {config && !capabilityFloor ? (
        <div className="pointer-events-none fixed inset-0 z-20">
          {armed ? (
            <Hud
              route={route}
              micAvailable={audio.micAvailable}
              activeSource={audio.source}
              onSetSource={audio.setSource}
            />
          ) : (
            <IntroOverlay route={route} onBegin={onBegin} />
          )}
        </div>
      ) : null}
    </>
  );
}
