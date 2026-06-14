/**
 * The pure auto-dim decision (ADR-004 §5) — when may the cinematic HUD recede?
 *
 * The HUD fades to a minimal state after a window of inactivity so the art owns
 * the screen, and returns on pointer / focus / key. The LOAD-BEARING a11y rule
 * (AGENT_NOTES gotcha): dimming is OPACITY ONLY and must NEVER hide a keyboard
 * focus target — if focus is inside the HUD the HUD stays visible. The decision
 * is a pure function of three booleans + the idle clock so it is Vitest-covered
 * without timers or the DOM.
 */

/** The inactivity window before the HUD dims (ms). */
export const HUD_IDLE_MS = 3200;

export interface AutoDimInput {
  /** ms since the last pointer/key activity. */
  idleMs: number;
  /** Whether keyboard focus is currently inside the HUD. */
  focusWithin: boolean;
  /** Whether the experience is armed (pre-arm the HUD is just the gate). */
  armed: boolean;
  /** Honour reduced-motion: when true, never animate the dim (caller shows it). */
  reducedMotion: boolean;
  /** The idle threshold (defaults to {@link HUD_IDLE_MS}). */
  idleThresholdMs?: number;
}

/**
 * Whether the HUD should be DIMMED right now.
 *
 *   - Focus inside the HUD → never dim (the a11y rule — a focused control must
 *     stay visible and reachable).
 *   - Not armed → never dim (the gate is the only chrome and must invite).
 *   - reduced-motion → never auto-dim (no fade animation; just show — the chrome
 *     should not move on its own for a reduced-motion user).
 *   - Otherwise → dim once idle past the threshold.
 *
 * Dimming is opacity only; the HUD always stays in the tab order and a11y tree
 * (the caller enforces that — this only decides the visual state).
 */
export function shouldDimHud(input: AutoDimInput): boolean {
  const {
    idleMs,
    focusWithin,
    armed,
    reducedMotion,
    idleThresholdMs = HUD_IDLE_MS,
  } = input;

  if (focusWithin) return false;
  if (!armed) return false;
  if (reducedMotion) return false;
  return idleMs >= idleThresholdMs;
}
