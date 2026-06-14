/**
 * Helper barrel for the nocturne-e2e specs. Re-exports the env resolver, the
 * diagnostics collector, the WebGL-denial init scripts, and the small set of
 * app facts the specs assert against (kept duplicated here, NOT imported from
 * `nocturne-web`, because the E2E package is a separate workspace member with
 * no path into the app's `src`).
 */
import { expect, type Page } from '@playwright/test';

export { baseUrl } from './env';
export { attachDiagnostics, type Diagnostics } from './diagnostics';
export { denyWebgl, denyFloatBuffer } from './webgl';

/**
 * Navigate to the `/` stage at the LOW capability tier (`?tier=low` → 65k
 * particles, the documented capture tier — AGENT_NOTES Pass-2/3).
 *
 * Why: headless chromium is software-GL (SwiftShader). The default `high` tier
 * (262k additive particles + bloom) takes MULTI-SECOND frames there, which
 * starves the shared GPU process and Playwright's in-page polling across the
 * serial suite (a tier-independent assertion can then time out purely from GPU
 * contention left by a prior test). Forcing `?tier=low` keeps the field cheap
 * enough that SwiftShader copes, making every chrome / a11y / route assertion
 * deterministic. The tier is a RENDER-cost knob only: the gate, the HUD, the
 * routing, the theme, the a11y tree, and the degradation paths are all
 * tier-independent, so `?tier=low` changes nothing the suite asserts (the live
 * 60fps field at the real `high`/`ultra` tier is proven separately on a real
 * GPU — it is explicitly NOT a headless E2E subject).
 *
 * `forceTierConfig` (the app) composes the reduced-motion branch when the page
 * also emulates `prefers-reduced-motion`, so `?tier=low` is compatible with the
 * calm-route tests.
 */
export async function gotoStage(page: Page, query = ''): Promise<void> {
  const sep = query ? `&${query}` : '';
  await page.goto(`/?tier=low${sep}`);
}

/**
 * Arm the experience from the intro gate, then return once the HUD has taken
 * over.
 *
 * Two deliberate choices:
 *   1. ACTIVATE BY KEYBOARD (focus + Enter), not `.click()`. The begin button
 *      carries a `motion-safe` entrance animation and sits over the (software-GL
 *      headless) canvas, so Playwright's pointer "stable" actionability check
 *      can never confirm — a `.click()` hangs. Keyboard activation has no
 *      stability wait and is the faithful keyboard-operability path anyway
 *      (ADR-003 §2: a real focusable button).
 *   2. The arm PROXY is the gate→HUD swap (the begin button is gone + the HUD's
 *      preset radiogroup is present), NOT the `data-armed` attribute.
 *      `data-armed` means "a live/calm experience surface is mounted (not the
 *      poster)" — the Stage sets it as soon as the capability probe resolves to
 *      a non-poster route, BEFORE any gesture. So `data-armed` is the
 *      not-the-poster signal, while the gate→HUD swap is the armed-by-gesture
 *      signal.
 */
export async function armFromGate(page: Page): Promise<void> {
  const begin = page.getByRole('button', { name: /press to begin/i });
  // Wait for the gate to be present + visible before driving it (the capability
  // probe + the intro's entrance render after mount; at small viewports it can
  // land a beat later).
  await expect(begin).toBeVisible({ timeout: 15_000 });
  await begin.focus();
  await page.keyboard.press('Enter');
  // The HUD replaces the gate: the begin button is gone, the radiogroup is up.
  await expect(begin).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.getByRole('radiogroup', { name: /preset/i }),
  ).toBeVisible({ timeout: 15_000 });
}

/** The six curated presets (id + visible name), in directory order. */
export const PRESETS = [
  { id: 'glacial-drift', name: 'Glacial Drift' },
  { id: 'molten-swirl', name: 'Molten Swirl' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'nocturne-noir', name: 'Nocturne Noir' },
  { id: 'solar-wind', name: 'Solar Wind' },
  { id: 'ink-bloom', name: 'Ink Bloom' },
] as const;

/** The default preset the field arms into (DEFAULT_PRESET_ID in the app). */
export const DEFAULT_PRESET = { id: 'aurora', name: 'Aurora' } as const;

/** The two routes in the IA. */
export const ROUTES = ['/', '/about'] as const;
