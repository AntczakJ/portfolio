import type { MotionMode, RenderRoute, TierConfig } from '@/lib/schemas';

/**
 * The pure tier / reduced-motion / capability routing helpers (Task 3.4,
 * ADR-004 §1–§2).
 *
 * `detectGpuTier()` produces the capability-derived `TierConfig` (the route the
 * environment alone implies). These helpers COMPOSE that with the user's HUD
 * intent — the `motionMode` toggle ("Still" → poster, or an explicit "full"
 * override the engine never auto-selects) — into the EFFECTIVE render route and
 * behaviour the stage mounts. Pure, no React, no GPU; unit-tested in Phase 7.
 */

/**
 * Resolve the EFFECTIVE render route from the capability config + the user's
 * motion-mode intent.
 *
 *   - A "still" intent always wins → poster (the user asked for zero motion).
 *   - If capability already routed to poster (Tier 4), it stays poster
 *     regardless of intent (you cannot run the field without the float gate).
 *   - Otherwise the capability route ("live" or "calm") stands.
 */
export function resolveRenderRoute(
  config: TierConfig,
  motionMode: MotionMode,
): RenderRoute {
  if (config.route === 'poster') return 'poster';
  if (motionMode === 'still') return 'poster';
  if (motionMode === 'calm') return 'calm';
  // motionMode === 'full' here (the 'still'/'calm' intents returned above):
  // honour it only where capability permits a live field.
  if (config.route === 'calm') {
    // The user explicitly opted back into full motion from the reduced-motion
    // default — allowed, but it is a user action, never auto-selected.
    return 'live';
  }
  return config.route;
}

/**
 * Whether the client is at the genuine CAPABILITY FLOOR (Tier 4) — no WebGL2, no
 * float render targets, or a software renderer — where the static poster +
 * scrollable SSR preset directory is the readable surface. This is DISTINCT from
 * the user choosing "Still" on a capable device: a capability-floor client
 * `config` is null (probe not yet resolved / SSR) or has `config.route ===
 * 'poster'`; a Still-mode toggle on a CAPABLE device leaves `config.route` at
 * 'live' or 'calm' (only the EFFECTIVE/resolved route becomes 'poster').
 *
 * The Stage drives the page-overflow LOCK and the `data-armed` attribute off
 * THIS, not the resolved route: live, calm, AND still on a capable device all
 * keep the page scroll-locked + the SSR directory hidden (they are the immersive
 * fullscreen stage). Only the genuine capability floor unlocks scroll + reveals
 * the directory + (for `software-webgl`) the hardware hint.
 */
export function isCapabilityFloor(config: TierConfig | null): boolean {
  return !config || config.route === 'poster';
}

/**
 * The default `motionMode` the experience should ADOPT for a given capability
 * config — what the store initialises to before any user toggle (ADR-004 §2):
 *   - poster route → 'still' (nothing to animate)
 *   - calm route (reduced-motion) → 'calm'
 *   - live route → 'full'
 */
export function defaultMotionMode(config: TierConfig): MotionMode {
  switch (config.route) {
    case 'poster':
      return 'still';
    case 'calm':
      return 'calm';
    case 'live':
      return 'full';
    default: {
      // Exhaustiveness guard — `RenderRoute` has no other members.
      return 'full';
    }
  }
}

/**
 * Whether the field should react to audio under the EFFECTIVE route + intent.
 * Audio reactivity is muted on the calm + poster routes (no audio-violent
 * motion); only a live field with a "full" intent reacts. Note: audio may still
 * PLAY under calm (the user can start the track) — it simply does not drive the
 * visuals (ADR-004 §2).
 */
export function isAudioReactive(
  config: TierConfig,
  motionMode: MotionMode,
): boolean {
  // The EFFECTIVE route already folds capability + intent (a poster/no-float
  // client never resolves to 'live'). The config's own `audioReactive` flag is
  // only the capability DEFAULT — an explicit 'full' override on a reduced-
  // motion (calm) config resolves the route to 'live' and the field reacts.
  const route = resolveRenderRoute(config, motionMode);
  return route === 'live' && motionMode === 'full';
}

/**
 * Whether the pointer/touch wake is active under the EFFECTIVE route + intent.
 * Gentle/off under calm; off under poster.
 */
export function isPointerWakeActive(
  config: TierConfig,
  motionMode: MotionMode,
): boolean {
  const route = resolveRenderRoute(config, motionMode);
  if (route !== 'live') return false;
  return motionMode === 'full';
}

/**
 * Whether the continuous render loop should run at all (ADR-002 §5). The loop
 * pauses under the poster route and when not armed; it runs (continuously) under
 * live and calm once armed. `tabHidden` forces it off (battery discipline).
 */
export function shouldRunLoop(
  route: RenderRoute,
  armed: boolean,
  tabHidden: boolean,
): boolean {
  if (tabHidden) return false;
  if (!armed) return false;
  return route === 'live' || route === 'calm';
}
