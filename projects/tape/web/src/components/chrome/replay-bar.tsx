'use client';

import type { ReactNode } from 'react';
import { useEffect, useId } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Pause, Play, Radio, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  REPLAY_DAY_MS,
  REPLAY_SPEEDS,
  useUiStore,
  type ReplaySpeed,
} from '@/lib/stores/ui-store';
import {
  useReplayLoadState,
  useReplayPlaying,
  useReplayStatusStore,
} from '@/lib/replay/replay-status-store';
import { cn } from '@/lib/cn';

/* -------------------------------------------------------------------------
 * ReplayBar — docked below the main canvas, above the StatusBar.
 *
 * Two visual states gated on `useUiStore.replayMode`:
 *   - `live`    thin track (~16 px) with a single Live pill. Clicking the
 *               pill flips the store to `'replay'` and expands the bar.
 *   - `replay`  full controls (~56 px): "Back to Live" button (left),
 *               full-width scrub slider (centre), 1x/5x/30x speed toggle
 *               (right). All controls only enabled in replay mode.
 *
 * Motion: the bar height animates on the same 220 ms easeOutCubic curve
 * the SideRail width transition uses, and collapses to `{ duration: 0 }`
 * under `useReducedMotion()`. The Phase 3 footprint chart pulls vertical
 * size from the layout flex column above this bar, so the animated
 * height change naturally reshapes the canvas with no manual measurement.
 *
 * Keyboard shortcuts (document-level listener, scoped):
 *   Space            toggle replayMode ↔ live
 *   ArrowLeft        -1 s
 *   ArrowRight       +1 s
 *   Shift+ArrowLeft  -10 s
 *   Shift+ArrowRight +10 s
 *
 * Shortcuts are suppressed when an input / textarea / contenteditable
 * surface owns focus so the chrome stays out of the way of future form
 * fields (symbol picker, alert dialogs).
 * --------------------------------------------------------------------- */

const BAR_HEIGHT_LIVE = 16;
const BAR_HEIGHT_REPLAY = 56;

const TRANSITION_DURATION_S = 0.22;
const TRANSITION_EASE = [0.33, 1, 0.68, 1] as const;

const SEEK_STEP_MS = 1_000;
const SEEK_STEP_LARGE_MS = 10_000;

function formatPositionLabel(ms: number): string {
  const clamped = Math.max(0, Math.min(REPLAY_DAY_MS, Math.floor(ms)));
  const totalSeconds = Math.floor(clamped / 1000);
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatAriaValueText(ms: number): string {
  return `${formatPositionLabel(ms)} UTC of session day 1`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function ReplayBar(): ReactNode {
  const replayMode = useUiStore((s) => s.replayMode);
  const setReplayMode = useUiStore((s) => s.setReplayMode);
  const replaySpeedX = useUiStore((s) => s.replaySpeedX);
  const setReplaySpeed = useUiStore((s) => s.setReplaySpeed);
  const replayPositionMs = useUiStore((s) => s.replayPositionMs);
  const setReplayPositionMs = useUiStore((s) => s.setReplayPositionMs);

  const playing = useReplayPlaying();
  const loadState = useReplayLoadState();
  const dispatch = useReplayStatusStore((s) => s.dispatch);

  const reduceMotion = useReducedMotion();
  const sliderLabelId = useId();

  const isReplay = replayMode === 'replay';
  const isEmpty = loadState === 'empty';
  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: TRANSITION_DURATION_S, ease: TRANSITION_EASE };

  // Document-level keyboard shortcuts. Listener attaches once and pulls
  // store snapshots through `useUiStore.getState()` to avoid re-binding
  // on every position update — the listener is stable, the store reads
  // are fresh.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const state = useUiStore.getState();

      if (event.code === 'Space') {
        event.preventDefault();
        state.setReplayMode(state.replayMode === 'replay' ? 'live' : 'replay');
        if (state.replayMode === 'replay') {
          // Switching back to live also resets the scrub position so the
          // next replay entry starts from session open.
          state.setReplayPositionMs(0);
        }
        return;
      }

      if (state.replayMode !== 'replay') return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const delta = event.shiftKey ? SEEK_STEP_LARGE_MS : SEEK_STEP_MS;
        state.setReplayPositionMs(state.replayPositionMs - delta);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        const delta = event.shiftKey ? SEEK_STEP_LARGE_MS : SEEK_STEP_MS;
        state.setReplayPositionMs(state.replayPositionMs + delta);
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, []);

  const handleBackToLive = (): void => {
    setReplayMode('live');
    setReplayPositionMs(0);
  };

  const handleSliderChange = (value: number[]): void => {
    const next = value[0];
    if (typeof next === 'number') {
      setReplayPositionMs(next);
    }
  };

  const handleSpeedChange = (value: string): void => {
    if (value === '') return; // ToggleGroup forbids deselect-to-empty.
    const next = Number(value);
    if (REPLAY_SPEEDS.includes(next as ReplaySpeed)) {
      setReplaySpeed(next as ReplaySpeed);
    }
  };

  return (
    <motion.section
      aria-label="Replay controls"
      animate={{ height: isReplay ? BAR_HEIGHT_REPLAY : BAR_HEIGHT_LIVE }}
      initial={false}
      transition={transition}
      // Reserve the resting height in CSS so the server-rendered box
      // already occupies its final space. Motion's `animate` only sets
      // the inline `height` AFTER mount (its effect runs post-paint), so
      // without this the bar would briefly collapse from `auto` to the
      // target on hydration and shift the chart above it (CLS). The style
      // height matches the live resting height; Motion takes over the
      // inline value identically on its first commit, so there is no jump.
      style={{ height: BAR_HEIGHT_LIVE }}
      className="relative shrink-0 overflow-hidden border-t border-(--color-border) bg-(--color-surface)"
    >
      {/* Mode-change announcement for screen readers. Polite so it does
          not interrupt; carries the empty-data state too so a replay of a
          dataless day is spoken rather than silently empty. */}
      <span className="sr-only" role="status" aria-live="polite">
        {isReplay
          ? isEmpty
            ? 'Replay mode. No replay data for this date.'
            : 'Replay mode active.'
          : 'Live mode active.'}
      </span>

      {!isReplay && (
        <div className="flex h-full items-center px-3 md:px-4">
          <button
            type="button"
            onClick={() => {
              setReplayMode('replay');
            }}
            aria-label="Enter replay mode"
            className="inline-flex items-center gap-1.5 rounded-(--radius-sm) px-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-(--color-fg-muted) transition-colors hover:text-(--color-fg)"
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-(--color-accent)"
            />
            <span>Live</span>
          </button>
        </div>
      )}

      {isReplay && (
        <div className="flex h-full items-center gap-3 px-3 md:gap-4 md:px-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleBackToLive}
            className="font-mono text-[11px]"
          >
            <Radio className="size-3.5" aria-hidden="true" />
            Back to Live
          </Button>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => {
                dispatch(playing ? 'pause' : 'play');
              }}
              disabled={isEmpty}
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              aria-pressed={playing}
            >
              {playing ? (
                <Pause className="size-3.5" aria-hidden="true" />
              ) : (
                <Play className="size-3.5" aria-hidden="true" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => {
                dispatch('stop');
              }}
              disabled={isEmpty}
              aria-label="Stop replay and return to session start"
            >
              <Square className="size-3" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              id={sliderLabelId}
              className="sr-only"
            >
              Replay scrub position
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex min-w-0 flex-1 items-center">
                  <Slider
                    aria-labelledby={sliderLabelId}
                    aria-valuetext={formatAriaValueText(replayPositionMs)}
                    value={[replayPositionMs]}
                    min={0}
                    max={REPLAY_DAY_MS}
                    step={SEEK_STEP_MS}
                    onValueChange={handleSliderChange}
                    disabled={!isReplay}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {formatAriaValueText(replayPositionMs)}
              </TooltipContent>
            </Tooltip>
            <span
              className="hidden font-mono text-[11px] tabular-nums text-(--color-fg-muted) sm:inline"
              data-numeric
            >
              {formatPositionLabel(replayPositionMs)}
            </span>
          </div>

          <ToggleGroup
            type="single"
            value={String(replaySpeedX)}
            onValueChange={handleSpeedChange}
            aria-label="Playback speed"
            spacing={2}
            disabled={!isReplay}
            className="shrink-0"
          >
            {REPLAY_SPEEDS.map((speed) => (
              <ToggleGroupItem
                key={speed}
                value={String(speed)}
                variant="outline"
                size="sm"
                aria-label={`Playback speed ${speed} times`}
                className="font-mono text-[11px]"
              >
                {`${speed}x`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {isEmpty && (
            <span
              className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-(--color-fg-subtle) md:inline"
              data-replay-empty
            >
              No data for this date
            </span>
          )}

          {/*
           * Dev-only state pip. The condition is a literal `'development'`
           * compare so Next.js / Terser inline `false` in production and
           * dead-code-eliminate the JSX (and the formatted string) at
           * build time. Verified post-build: the literal `mode:replay`
           * does not appear in `.next/static`.
           */}
          {process.env.NODE_ENV === 'development' && (
            <DevStatusPip
              mode={replayMode}
              speedX={replaySpeedX}
              positionLabel={formatPositionLabel(replayPositionMs)}
            />
          )}
        </div>
      )}
    </motion.section>
  );
}

interface DevStatusPipProps {
  mode: 'live' | 'replay';
  speedX: ReplaySpeed;
  positionLabel: string;
}

function DevStatusPip({
  mode,
  speedX,
  positionLabel,
}: DevStatusPipProps): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-(--color-fg-subtle) lg:inline',
      )}
      data-replay-debug
    >
      {`mode:${mode} ${speedX}x @ ${positionLabel}`}
    </span>
  );
}
