import {
  configuratorOptionSchema,
  type ConfiguratorOption,
} from '@/lib/schemas/configurator-option';

import { SEED_CONFIGURATOR_OPTIONS } from './seed-data';

/**
 * Configurator-options mock accessor (Task 3.2).
 *
 * Parsed through the schema (whose superRefine guarantees the render matrix
 * covers every colour × wheel combination — the ADR-004 "must not drift"
 * contract), so a missing pre-baked still fails fast at authoring time.
 */
export const CONFIGURATOR_OPTIONS: ConfiguratorOption =
  configuratorOptionSchema.parse(SEED_CONFIGURATOR_OPTIONS);

/** Resolve the pre-baked render still for a (colour, wheel) selection. */
export function getRenderStill(
  colorId: string,
  wheelId: string,
): string | undefined {
  return CONFIGURATOR_OPTIONS.renderMatrix[`${colorId}:${wheelId}`];
}

/**
 * Resolve the still for a given theme. The dark "night drive" stage stills live
 * alongside the light ones under `matrix-dark/` (a re-key, not an inversion —
 * ADR-001 / Task 4.4), so the dark theme shows a night studio, not a light car
 * on a dark page. Derived from the light path so the schema's matrix-coverage
 * refinement stays the single source of truth.
 */
export function getThemedRenderStill(
  colorId: string,
  wheelId: string,
  theme: 'light' | 'dark',
): string | undefined {
  const light = getRenderStill(colorId, wheelId);
  if (!light) return undefined;
  return theme === 'dark' ? light.replace('/matrix/', '/matrix-dark/') : light;
}

/** The default configuration (first paint / no-JS / deep-link fallback). */
export const DEFAULT_CONFIG = {
  colorId: CONFIGURATOR_OPTIONS.defaultColorId,
  wheelId: CONFIGURATOR_OPTIONS.defaultWheelId,
} as const;
