'use client';

import { create } from 'zustand';

/**
 * A tiny toast store + `<Toaster>` (see `components/ui/toaster.tsx`).
 *
 * We do NOT pull in `sonner` or a second toast library: the project's single
 * animation library is Motion (conventions § 15), and a toast is exactly the
 * kind of enter/exit `AnimatePresence` transition Motion is the default for.
 * Adding sonner would either stack a second animation system or fight Motion's
 * reduced-motion gating. So the toaster is hand-rolled on Motion + this store.
 *
 * The wow-moment alert toast (the `alert.fired` SSE sink) and the demo-button
 * recovery toast both push through `pushToast`. Each toast auto-dismisses after
 * its `duration` (default ~4 s), or can be dismissed by the user.
 *
 * COHERENCE RULES (C-2 — the toast stack must read as one event, not noise):
 *  - `MAX_VISIBLE = 3` — the stack is capped; the oldest is evicted first.
 *  - `dedupeKey` — a second toast with the same key REPLACES the first (a burst
 *    of identical events does not pile up).
 *  - `supersedeKey` — a per-subject key (typically `monitor-<id>`). A NEW toast
 *    with a supersede key EVICTS any visible toast carrying the SAME supersede
 *    key before it is added. So "Alert sent: X is down" supersedes a stale
 *    "Recovered: X is back up" for the same monitor — the stack can never show
 *    a monitor as both down and recovered at once.
 *  - `dismissKeys` — pushing a toast can dismiss other visible toasts by id.
 *    The incident-open toast dismisses the "Demo armed" info toast the instant
 *    the incident actually opens, so the narration never contradicts reality.
 */

export type ToastTone = 'down' | 'up' | 'info';

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly description?: string;
  /** Auto-dismiss after this many ms. 0 = sticky (manual dismiss only). */
  readonly duration: number;
  /** Per-subject coherence key; a newer toast with this key evicts older ones. */
  readonly supersedeKey?: string;
}

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  duration?: number;
  /**
   * Optional stable key. A second toast with the same `dedupeKey` while the
   * first is still visible REPLACES it rather than stacking — used so a burst
   * of identical `alert.fired` events does not pile up duplicate toasts.
   */
  dedupeKey?: string;
  /**
   * Per-subject coherence key (e.g. `monitor-<id>`). Pushing a toast with this
   * key first evicts any visible toast that carries the SAME key — so a new
   * "down" alert for a monitor supersedes that monitor's prior "recovered"
   * toast (and vice versa). Distinct from `dedupeKey`: dedupe replaces an
   * identical toast; supersede replaces a DIFFERENT toast about the same thing.
   */
  supersedeKey?: string;
  /** Ids of visible toasts to dismiss when this toast is pushed. */
  dismissKeys?: readonly string[];
}

interface ToastState {
  readonly toasts: readonly Toast[];
  pushToast: (input: ToastInput) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

const DEFAULT_DURATION = 4_000;
const MAX_VISIBLE = 3;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `toast-${String(counter)}-${String(Date.now())}`;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  pushToast: (input) => {
    const id = input.dedupeKey ?? nextId();
    const toast: Toast = {
      id,
      tone: input.tone ?? 'info',
      title: input.title,
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      duration: input.duration ?? DEFAULT_DURATION,
      ...(input.supersedeKey !== undefined
        ? { supersedeKey: input.supersedeKey }
        : {}),
    };
    const dismiss = new Set(input.dismissKeys ?? []);
    set((state) => {
      // 1. Drop any toast this push explicitly dismisses (e.g. the armed
      //    info toast when the incident opens), plus the same-id (dedupe) and
      //    same-supersede-key (per-subject) toasts.
      const without = state.toasts.filter(
        (t) =>
          t.id !== id &&
          !dismiss.has(t.id) &&
          !(toast.supersedeKey != null && t.supersedeKey === toast.supersedeKey),
      );
      const next = [...without, toast];
      // 2. Cap the visible stack, evicting the OLDEST first.
      return {
        toasts: next.slice(Math.max(0, next.length - MAX_VISIBLE)),
      };
    });
    return id;
  },
  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
  clearToasts: () => {
    set({ toasts: [] });
  },
}));

/** Imperative helper for non-component call sites. */
export function pushToast(input: ToastInput): string {
  return useToastStore.getState().pushToast(input);
}
