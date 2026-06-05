/**
 * Hero -> configurator seam contract (ADR-004 G1 / Task 4.2).
 *
 * The ONE sanctioned coupling point where the inside-canvas (R3F) and
 * outside-canvas (GSAP) boundaries meet, modelled as STRICTLY ONE-DIRECTIONAL
 * VALUE PASSING (ADR-002 §1, ADR-004 G1):
 *
 *   GSAP (the scroll-hero pinned timeline) WRITES a normalised seam-progress
 *   number in [0, 1] here as the viewer scrolls the first viewport.
 *
 *   R3F (the live configurator canvas — Task 4.4) READS that number inside its
 *   own `useFrame`/`invalidate` loop to interpolate the intro camera at the
 *   reveal. The two libraries never write the same property; GSAP never touches
 *   the scene, R3F never touches the DOM scroll.
 *
 * This module is the shared, framework-agnostic surface so the hero (Task 4.2)
 * can write the value now and the canvas (Task 4.4) can subscribe later without
 * a circular import or a coupling to the GSAP/R3F lifecycles. It is a tiny
 * module-level store with a subscribe API (no Zustand dependency needed for a
 * single number — the reservation Zustand store is for the wizard draft, not
 * this ephemeral scroll value).
 *
 * `readyState` is the OTHER half of the seam: the live canvas reports when it
 * has rendered its first frame AND the GLB is loaded (ADR-004 reveal-when-
 * ready), so the hero knows when it is safe to crossfade the static render out.
 * Task 4.4 wires the canvas to set this; Task 4.2 only needs the writer + the
 * type so the contract is in place.
 */

export type SeamReadyState = 'idle' | 'loading' | 'ready' | 'failed';

interface SeamState {
  /** Normalised scroll-hero progress [0, 1] written by GSAP. */
  progress: number;
  /** The live-canvas readiness signal written by R3F (Task 4.4). */
  ready: SeamReadyState;
}

type Listener = (state: Readonly<SeamState>) => void;

const state: SeamState = { progress: 0, ready: 'idle' };
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(state);
}

/** GSAP writes the normalised scroll-hero progress (clamped to [0, 1]). */
export function setSeamProgress(value: number): void {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  if (clamped === state.progress) return;
  state.progress = clamped;
  emit();
}

/** R3F (Task 4.4) reports live-canvas readiness for the reveal-when-ready swap. */
export function setSeamReady(ready: SeamReadyState): void {
  if (ready === state.ready) return;
  state.ready = ready;
  emit();
}

/** Read the current seam state (R3F reads `progress` inside its frame loop). */
export function getSeamState(): Readonly<SeamState> {
  return state;
}

/** Subscribe to seam changes; returns an unsubscribe. */
export function subscribeSeam(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
