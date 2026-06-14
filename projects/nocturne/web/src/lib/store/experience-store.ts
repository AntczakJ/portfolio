'use client';

import { create } from 'zustand';

import { DEFAULT_PRESET_ID, getPreset } from '@/data/presets';
import type {
  ArmState,
  AudioSourceKind,
  MotionMode,
} from '@/lib/schemas';

/**
 * The experience / HUD state machine (Task 1.2, the Zustand store skeleton).
 *
 * The single client source of truth shared by the chrome (the preset picker,
 * the audio-source picker, the controls, the intro gate) and — in Pass 2 — the
 * R3F engine (which reads `presetId` / `transitioningToId` to drive the
 * cross-fade, `audioSource` / `muted` for the audio graph, `motionMode` /
 * `pointerInteraction` for the routing). NO TanStack Query: there is no async
 * server data; presets are static (ADR-001 / AGENT_NOTES #7).
 *
 * This is a SKELETON for Pass 1 — the actions are the state-machine contract the
 * tests assert and the engine + HUD will consume; the imperative side effects
 * (resuming the AudioContext, arming the render loop) are wired in Pass 2/3.
 */

export interface ExperienceState {
  /** The active preset id. */
  presetId: string;
  /** The id the field is cross-fading TOWARD, or null when settled. */
  transitioningToId: string | null;
  audioSource: AudioSourceKind;
  muted: boolean;
  armState: ArmState;
  motionMode: MotionMode;
  pointerInteraction: boolean;
  hudDimmed: boolean;

  // --- actions (the state-machine transitions) ---------------------------
  /** Begin a cross-fade to `id` (no-op if unknown or already active/target). */
  selectPreset: (id: string) => void;
  /** Settle the cross-fade — the engine calls this when progress reaches 1. */
  completePresetTransition: () => void;
  setAudioSource: (source: AudioSourceKind) => void;
  toggleMute: () => void;
  setMuted: (muted: boolean) => void;
  /** Arm the field (the gesture gate). Idempotent. */
  arm: () => void;
  setMotionMode: (mode: MotionMode) => void;
  togglePointerInteraction: () => void;
  setHudDimmed: (dimmed: boolean) => void;
}

export const useExperienceStore = create<ExperienceState>((set, get) => ({
  presetId: DEFAULT_PRESET_ID,
  transitioningToId: null,
  audioSource: 'builtin',
  muted: false,
  armState: 'idle',
  motionMode: 'full',
  pointerInteraction: true,
  hudDimmed: false,

  selectPreset: (id) => {
    const target = getPreset(id);
    if (!target) return; // unknown preset — guard
    const { presetId, transitioningToId } = get();
    if (id === presetId && transitioningToId === null) return; // already active
    if (id === transitioningToId) return; // already transitioning to it
    set({ transitioningToId: id });
  },

  completePresetTransition: () => {
    const { transitioningToId } = get();
    if (transitioningToId === null) return;
    set({ presetId: transitioningToId, transitioningToId: null });
  },

  setAudioSource: (source) => { set({ audioSource: source }); },

  toggleMute: () => { set((s) => ({ muted: !s.muted })); },
  setMuted: (muted) => { set({ muted }); },

  arm: () => {
    if (get().armState === 'armed') return;
    set({ armState: 'armed' });
  },

  setMotionMode: (mode) => { set({ motionMode: mode }); },

  togglePointerInteraction: () => {
    set((s) => ({ pointerInteraction: !s.pointerInteraction }));
  },

  setHudDimmed: (dimmed) => { set({ hudDimmed: dimmed }); },
}));
