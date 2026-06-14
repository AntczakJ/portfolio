'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { Poster } from '@/components/poster/poster';
import { getPresetOrDefault } from '@/data/presets';
import { detectGpuTier, forceTierConfig } from '@/lib/engine/detect-gpu-tier';
import {
  defaultMotionMode,
  isAudioReactive,
  isPointerWakeActive,
  resolveRenderRoute,
  shouldRunLoop,
} from '@/lib/engine/routing';
import { describeFieldState } from '@/lib/hud/describe-state';
import { useExperienceStore } from '@/lib/store/experience-store';
import type { RenderRoute, TierConfig } from '@/lib/schemas';

import { FieldCanvas } from './field-canvas';
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

  // When the live/calm experience is available, hide the SSR no-JS DOM fallback
  // (the field + HUD are the experience). On the poster route (Tier 4) the SSR
  // directory STAYS visible — it is the readable surface. The CSS rule
  // `[data-armed] [data-nojs-fallback] { display: none }` does the hiding.
  useEffect(() => {
    const root = document.documentElement;
    if (route === 'poster') {
      root.removeAttribute('data-armed');
    } else {
      root.setAttribute('data-armed', '');
    }
    return () => {
      root.removeAttribute('data-armed');
    };
  }, [route]);

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

  const showField = route !== 'poster';
  const revealed = fieldReady && armed;

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
            style={{ opacity: revealed ? 0 : 1 }}
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

      {/* The intro gate (pre-arm) → the HUD (post-arm), ABOVE the page content
          (`z-20`). The wrapper is click-through; its children opt back in. */}
      {config && route !== 'poster' ? (
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
