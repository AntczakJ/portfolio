'use client';

import { create } from 'zustand';

/**
 * Drives the global auth dialog (Task 6.4 / 6.5).
 *
 * The dialog lives once near the root (mounted in the dashboard + marketing
 * shells) and is opened from anywhere via `openAuthPrompt`. A gated write
 * affordance (create monitor, etc.) opens it with a `reason` so the dialog can
 * lead with "Sign in to create your own monitors" instead of a bare form — the
 * tasteful prompt the demo-open posture promises (never a raw error).
 *
 * Keeping this in a tiny Zustand store (not React context) means the affordances
 * scattered across the board / detail / alerts surfaces can prompt sign-in
 * without threading callbacks through every component.
 */

export type AuthMode = 'sign-in' | 'sign-up';

interface AuthPromptState {
  readonly open: boolean;
  readonly mode: AuthMode;
  /** Contextual line shown above the form, e.g. "Sign in to create monitors." */
  readonly reason: string | null;
  openAuthPrompt: (args?: { mode?: AuthMode; reason?: string }) => void;
  setMode: (mode: AuthMode) => void;
  closeAuthPrompt: () => void;
}

export const useAuthPromptStore = create<AuthPromptState>((set) => ({
  open: false,
  mode: 'sign-in',
  reason: null,
  openAuthPrompt: (args) => {
    set({
      open: true,
      mode: args?.mode ?? 'sign-in',
      reason: args?.reason ?? null,
    });
  },
  setMode: (mode) => {
    set({ mode });
  },
  closeAuthPrompt: () => {
    set({ open: false });
  },
}));

/** Imperative helper for non-component call sites (mutation onError handlers). */
export function openAuthPrompt(args?: { mode?: AuthMode; reason?: string }): void {
  useAuthPromptStore.getState().openAuthPrompt(args);
}
