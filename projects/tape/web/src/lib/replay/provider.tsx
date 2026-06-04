'use client';

/**
 * ReplayProvider — runs the replay engine while the app is in REPLAY
 * mode (Task 3.6).
 *
 * Mounted ONLY when `useUiStore.replayMode === 'replay'` (the mode
 * controller swaps it in for the live WS provider, so the two data
 * sources never fight the store). On mount it:
 *
 *   1. Resets the stream store + constructs a `ReplayEngine` bound to the
 *      runtime replay Zod schemas (validate every NDJSON line at the
 *      boundary, per docs/conventions.md § 5).
 *   2. Enters the session for `useUiStore.replayDate` at the persisted
 *      scrub position, which starts the cell stream + virtual clock.
 *   3. Subscribes to `useUiStore` for speed changes (live-read by the
 *      clock) and for COMMANDED scrub-position changes (slider drag /
 *      arrow-key seek) — distinguishing the engine's OWN cursor writes
 *      from external commands via a guard ref so a seek does not echo
 *      back into another seek.
 *   4. On unmount (leaving replay), `exit()` aborts in-flight fetches and
 *      cancels the clock. The mode controller then remounts the live WS
 *      provider, which resets the store + reconnects for a fresh
 *      snapshot.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  replayCellRowSchema,
  replayTickRowSchema,
} from 'tape-server/replay-schemas';

import { env } from '@/lib/env';
import { useStreamStore } from '@/lib/stores/stream-store';
import { useUiStore } from '@/lib/stores/ui-store';
import { ReplayEngine } from './engine';
import { useReplayStatusStore } from './replay-status-store';

/** Canonical symbol for the replay URL — v1 single-symbol (PLAN.md). */
const REPLAY_SYMBOL = 'BTCUSDT-PERP';

export function ReplayProvider(): ReactNode {
  const engineRef = useRef<ReplayEngine | null>(null);
  // Guards the cursor echo: when the engine writes the cursor back to the
  // ui-store during playback, the position subscription would otherwise
  // treat it as a commanded seek and rebuild the chart every frame.
  const engineCursorRef = useRef<number>(-1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (engineRef.current !== null) return;

    const status = useReplayStatusStore.getState();
    const engine = new ReplayEngine({
      apiUrl: env.apiUrl,
      symbol: REPLAY_SYMBOL,
      streamStore: useStreamStore,
      prefersReducedMotion: reduceMotion === true,
      parsers: {
        parseCell: (value) => {
          const r = replayCellRowSchema.safeParse(value);
          return r.success ? { ok: true, value: r.data } : { ok: false };
        },
        parseTick: (value) => {
          const r = replayTickRowSchema.safeParse(value);
          return r.success ? { ok: true, value: r.data } : { ok: false };
        },
      },
      getSpeedX: () => useUiStore.getState().replaySpeedX,
      onCursorChange: (cursorMs) => {
        // Record the engine's own write so the position subscription can
        // tell it apart from a user-commanded seek, then push it to the
        // slider.
        engineCursorRef.current = cursorMs;
        useUiStore.getState().setReplayPositionMs(cursorMs);
      },
      onLoadState: (loadState) => {
        useReplayStatusStore.getState().setLoadState(loadState);
      },
      onPlayingChange: (playing) => {
        useReplayStatusStore.getState().setPlaying(playing);
      },
    });
    engineRef.current = engine;

    const ui = useUiStore.getState();
    status.reset();
    engine.enter(ui.replayDate, ui.replayPositionMs);
    engineCursorRef.current = ui.replayPositionMs;

    // React to speed + commanded-position changes on the ui-store.
    const unsubscribeUi = useUiStore.subscribe((state, prev) => {
      if (state.replaySpeedX !== prev.replaySpeedX) {
        engine.setSpeed();
      }
      if (state.replayPositionMs !== prev.replayPositionMs) {
        // Ignore the engine's own cursor echo; only react to external
        // commands (slider drag, arrow-key seek).
        if (state.replayPositionMs !== engineCursorRef.current) {
          engine.seek(state.replayPositionMs);
        }
      }
    });

    // React to play / pause / stop commands from the replay bar.
    const unsubscribeCmd = useReplayStatusStore.subscribe((state, prev) => {
      const cmd = state.command;
      if (cmd === null || cmd === prev.command) return;
      if (cmd.type === 'play') engine.play();
      else if (cmd.type === 'pause') engine.pause();
      else engine.stop();
    });

    return () => {
      unsubscribeUi();
      unsubscribeCmd();
      engine.exit();
      engineRef.current = null;
      useReplayStatusStore.getState().reset();
    };
    // The engine is constructed once per replay-mode entry. Speed /
    // position are handled via the live subscription above, not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
