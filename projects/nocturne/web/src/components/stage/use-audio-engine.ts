'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { AudioEngine } from '@/lib/audio/audio-engine';
import type { AudioSourceKind } from '@/lib/schemas';

/**
 * Owns the imperative `AudioEngine` for the stage's lifetime and exposes the
 * gesture-gated `arm()` + source/mute controls (ADR-003). The engine is created
 * lazily (so no AudioContext exists pre-gesture) and disposed on unmount
 * (leak-free teardown — the reviewer item).
 */
export interface UseAudioEngine {
  /** The engine instance (null until first armed), for the render loop to read. */
  engineRef: { current: AudioEngine | null };
  armed: boolean;
  micAvailable: boolean;
  source: AudioSourceKind;
  /** Create + resume the context, start the procedural source (a user gesture). */
  arm: () => Promise<void>;
  setSource: (source: AudioSourceKind, file?: File) => Promise<boolean>;
  setMuted: (muted: boolean) => void;
}

export function useAudioEngine(): UseAudioEngine {
  const engineRef = useRef<AudioEngine | null>(null);
  const [armed, setArmed] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);
  const [source, setSourceState] = useState<AudioSourceKind>('builtin');

  useEffect(() => {
    // create the (un-armed) engine once, after mount — no AudioContext exists
    // yet (it is built lazily on the gesture), this only lets micAvailable be
    // probed for the HUD. Disposed on unmount (leak-free teardown).
    const engine = new AudioEngine();
    engineRef.current = engine;
    setMicAvailable(engine.micAvailable);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const arm = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    await engine.arm();
    setArmed(engine.isArmed);
    setSourceState(engine.getSource());
  }, []);

  const setSource = useCallback(
    async (next: AudioSourceKind, file?: File) => {
      const engine = engineRef.current;
      if (!engine) return false;
      const ok = await engine.setSource(next, file);
      setSourceState(engine.getSource());
      return ok;
    },
    [],
  );

  const setMuted = useCallback((muted: boolean) => {
    engineRef.current?.setMuted(muted);
  }, []);

  return { engineRef, armed, micAvailable, source, arm, setSource, setMuted };
}
