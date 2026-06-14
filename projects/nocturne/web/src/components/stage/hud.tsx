'use client';

import {
  Hand,
  Info,
  Maximize,
  Mic,
  Minimize,
  MousePointer2,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { shouldDimHud } from '@/lib/hud/auto-dim';
import { useExperienceStore } from '@/lib/store/experience-store';
import type { AudioSourceKind, MotionMode, RenderRoute } from '@/lib/schemas';

import { HudButton } from './hud-button';
import { PresetPicker } from './preset-picker';
import { ThemeToggle } from './theme-toggle';

/**
 * The cinematic HUD (Task 5.1, ADR-004 §5) — a minimal, auto-dimming, sovereign-
 * dark control surface over the live field. Every control is real, keyboard-
 * operable DOM with AA-contrast ink over the scrim and brand-styled focus.
 *
 * Auto-dim (the load-bearing a11y rule): the HUD fades to a minimal opacity after
 * idle and returns on pointer / focus / key — but NEVER drops keyboard
 * reachability or a11y-tree presence (it stays `pointer-events`-live and in the
 * tab order; focus brings it back). Under reduced-motion it never auto-dims and
 * does not animate (the pure `shouldDimHud` decides). CSS-only transitions.
 */

export interface HudProps {
  route: RenderRoute;
  micAvailable: boolean;
  activeSource: AudioSourceKind;
  onSetSource: (source: AudioSourceKind, file?: File) => Promise<boolean>;
}

export function Hud({
  route,
  micAvailable,
  activeSource,
  onSetSource,
}: HudProps): ReactNode {
  const presetId = useExperienceStore((s) => s.presetId);
  const transitioningToId = useExperienceStore((s) => s.transitioningToId);
  const selectPreset = useExperienceStore((s) => s.selectPreset);
  const muted = useExperienceStore((s) => s.muted);
  const toggleMute = useExperienceStore((s) => s.toggleMute);
  const motionMode = useExperienceStore((s) => s.motionMode);
  const setMotionMode = useExperienceStore((s) => s.setMotionMode);
  const pointerInteraction = useExperienceStore((s) => s.pointerInteraction);
  const togglePointerInteraction = useExperienceStore(
    (s) => s.togglePointerInteraction,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Seeded to 0; set to a real timestamp inside the effect (below) and on every
  // activity. Avoids calling the impure `Date.now()` during render.
  const lastActivity = useRef<number>(0);

  const [dimmed, setDimmed] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  const reducedMotion = route === 'calm';
  const isLive = route === 'live';

  // --- auto-dim: poll the idle clock; the pure decision gates the opacity ----
  useEffect(() => {
    lastActivity.current = Date.now();
    const tick = (): void => {
      const idleMs = Date.now() - lastActivity.current;
      setDimmed(
        shouldDimHud({
          idleMs,
          focusWithin,
          armed: true,
          reducedMotion,
        }),
      );
    };
    const id = window.setInterval(tick, 500);
    const wake = (): void => {
      lastActivity.current = Date.now();
      setDimmed(false);
    };
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [focusWithin, reducedMotion]);

  // --- fullscreen state mirror ----------------------------------------------
  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    // Swallow the fullscreen rejection (a denied request is non-fatal — the HUD
    // simply stays windowed). The handler returns a value so it is not an empty
    // function body.
    const ignore = (): undefined => undefined;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(ignore);
    } else {
      void document.documentElement.requestFullscreen().catch(ignore);
    }
  }, []);

  const onPickSource = useCallback(
    async (kind: AudioSourceKind) => {
      if (kind === 'upload') {
        fileInputRef.current?.click();
        return;
      }
      const ok = await onSetSource(kind);
      if (kind === 'mic') setMicDenied(!ok);
    },
    [onSetSource],
  );

  const motionModes: { mode: MotionMode; label: string; icon: ReactNode }[] = [
    { mode: 'full', label: 'Full', icon: <Sparkles className="size-3.5" aria-hidden /> },
    { mode: 'calm', label: 'Calm', icon: <Wind className="size-3.5" aria-hidden /> },
    { mode: 'still', label: 'Still', icon: <Hand className="size-3.5" aria-hidden /> },
  ];

  return (
    <div
      ref={rootRef}
      onFocusCapture={() => {
        setFocusWithin(true);
        setDimmed(false);
      }}
      onBlurCapture={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget)) {
          setFocusWithin(false);
        }
      }}
      data-dimmed={dimmed || undefined}
      // Opacity ONLY when dimmed — the HUD stays in the tab order + a11y tree +
      // pointer-events-live (the a11y rule: dimming never drops reachability).
      className="pointer-events-none absolute inset-0 transition-opacity duration-[var(--duration-slow)] ease-[var(--ease-out-expo)] data-[dimmed]:opacity-25 motion-reduce:transition-none"
    >
      {/* ---- top bar: wordmark + chrome controls --------------------------- */}
      <header className="pointer-events-auto absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4 sm:p-5">
        <span
          className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-[0.34em] uppercase"
          style={{ color: 'var(--hud-ink)' }}
        >
          Nocturne
        </span>
        <div className="hud-scrim flex items-center gap-1 rounded-[var(--radius-full)] px-1.5 py-1">
          <HudButton iconOnly aria-label="Toggle fullscreen" title="Fullscreen" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize className="size-4" aria-hidden /> : <Maximize className="size-4" aria-hidden />}
          </HudButton>
          <ThemeToggle />
          <Link
            href="/about"
            aria-label="About this piece"
            title="About"
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--hud-ink-muted)] transition-colors hover:text-[var(--hud-ink)] focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ outlineColor: 'var(--color-accent)' }}
          >
            <Info className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      {/* ---- bottom bar: presets + audio + motion -------------------------- */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3 sm:p-5">
        {/* The bottom control bar uses the STRONG scrim (D-04): it sits over the
         * brightest field region, where an additive bloom peak (molten / solar-
         * wind near-white) drives the 62% --stage-scrim to ~2.2:1 (FAILS AA). The
         * 82% --stage-scrim-strong + soft shadow keeps every control AA-legible
         * against the worst-case bloom. Capped at max-w-5xl so the instrument
         * stays a compact lockup on ultra-wide displays (D-08). */}
        <div className="hud-scrim-strong flex w-full max-w-[min(96vw,64rem)] flex-col gap-2 rounded-[var(--radius-xl)] px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
          {/* presets */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="sr-only">Choose a preset</span>
            <div className="-mx-1 overflow-x-auto px-1">
              <PresetPicker
                activeId={presetId}
                targetId={transitioningToId}
                onSelect={selectPreset}
              />
            </div>
          </div>

          <Divider />

          {/* audio source */}
          <div role="group" aria-label="Audio source" className="flex items-center gap-1">
            <HudButton
              active={activeSource === 'builtin'}
              aria-pressed={activeSource === 'builtin'}
              onClick={() => void onPickSource('builtin')}
            >
              Synth
            </HudButton>
            {micAvailable ? (
              <HudButton
                active={activeSource === 'mic'}
                aria-pressed={activeSource === 'mic'}
                onClick={() => void onPickSource('mic')}
              >
                <Mic className="size-3.5" aria-hidden />
                Mic
              </HudButton>
            ) : (
              <HudButton
                disabled
                aria-disabled
                title="Microphone needs a secure (HTTPS) context"
                className="cursor-not-allowed opacity-50"
              >
                <Mic className="size-3.5" aria-hidden />
                Mic
              </HudButton>
            )}
            <HudButton
              active={activeSource === 'upload'}
              aria-pressed={activeSource === 'upload'}
              onClick={() => void onPickSource('upload')}
            >
              <Upload className="size-3.5" aria-hidden />
              File
            </HudButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="sr-only"
              aria-label="Upload an audio file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onSetSource('upload', file);
              }}
            />
            <HudButton
              iconOnly
              active={muted}
              aria-pressed={muted}
              aria-label={muted ? 'Unmute' : 'Mute'}
              title={muted ? 'Unmute' : 'Mute'}
              onClick={toggleMute}
            >
              {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
            </HudButton>
          </div>

          <Divider />

          {/* motion mode */}
          <div role="group" aria-label="Motion mode" className="flex items-center gap-1">
            {motionModes.map(({ mode, label, icon }) => (
              <HudButton
                key={mode}
                active={motionMode === mode}
                aria-pressed={motionMode === mode}
                aria-label={`${label} motion`}
                onClick={() => {
                  setMotionMode(mode);
                }}
                title={`${label} motion`}
              >
                {icon}
                <span className="hidden sm:inline" aria-hidden>
                  {label}
                </span>
              </HudButton>
            ))}
            {/* pointer interaction toggle — only meaningful on a live field */}
            <HudButton
              iconOnly
              active={pointerInteraction}
              aria-pressed={pointerInteraction}
              aria-label={
                pointerInteraction
                  ? 'Disable pointer interaction'
                  : 'Enable pointer interaction'
              }
              title="Pointer interaction"
              disabled={!isLive}
              className={!isLive ? 'opacity-40' : undefined}
              onClick={togglePointerInteraction}
            >
              <MousePointer2 className="size-4" aria-hidden />
            </HudButton>
          </div>
        </div>

        {micDenied ? (
          <p
            role="status"
            className="hud-scrim rounded-[var(--radius-md)] px-3 py-1.5 text-xs"
            style={{ color: 'var(--color-warning)' }}
          >
            Microphone unavailable — staying on the previous source.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Divider(): ReactNode {
  return (
    <span
      aria-hidden
      className="hidden h-5 w-px self-center sm:block"
      style={{ backgroundColor: 'var(--hud-hairline)' }}
    />
  );
}
