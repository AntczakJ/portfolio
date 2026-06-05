import '@/lib/zod-config';

import { z } from 'zod';

import { idSchema } from './common';

/**
 * ConfiguratorOption — the colour palette + wheel sets for the configurable
 * hero vehicle, plus the pre-baked render matrix (ADR-003 / ADR-004).
 *
 * `renderMatrix` maps each `${colorId}:${wheelId}` key to a pre-baked AVIF
 * still rendered offline from the SAME camera/lighting rig as the live scene
 * (ADR-004 "one rig, three outputs"). It is the Tier-3 fallback source: when
 * the capability gate routes to no-WebGL, the configurator swaps these stills
 * instead of mutating a live scene. Kept small (a handful of colours × 2–3
 * wheels) to bound asset weight (PLAN.md out-of-scope).
 */

/** A single paint option: a name, a display hex (swatch UI), a material hint. */
export const configuratorColorSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(48),
  /** Display hex for the DOM swatch (the live scene maps it to a material). */
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex colour'),
  /** Material/finish name shown in the spec + the screen-reader alternative. */
  materialName: z.string().trim().min(1).max(48),
});
export type ConfiguratorColor = z.infer<typeof configuratorColorSchema>;

/** A single wheel set: a name + a preview thumbnail for the swatch UI. */
export const configuratorWheelSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(48),
  /** Path to the AVIF wheel-thumbnail (same-origin static asset). */
  previewSrc: z.string().trim().min(1),
});
export type ConfiguratorWheel = z.infer<typeof configuratorWheelSchema>;

/**
 * The render-matrix key is `${colorId}:${wheelId}`. Modelled as a
 * `Record<string, string>` (Zod has no template-literal key type), with a
 * runtime guard below that every (color × wheel) combination is present.
 */
export const renderMatrixSchema = z.record(
  z.string().regex(/^[^:]+:[^:]+$/, 'Matrix key must be `colorId:wheelId`'),
  z.string().trim().min(1),
);
export type RenderMatrix = z.infer<typeof renderMatrixSchema>;

export const configuratorOptionSchema = z
  .object({
    vehicleId: idSchema,
    colors: z.array(configuratorColorSchema).min(1),
    wheels: z.array(configuratorWheelSchema).min(1),
    /** Default selection for first paint / no-JS / deep-link fallback. */
    defaultColorId: idSchema,
    defaultWheelId: idSchema,
    renderMatrix: renderMatrixSchema,
  })
  .superRefine((option, ctx) => {
    const colorIds = new Set(option.colors.map((c) => c.id));
    const wheelIds = new Set(option.wheels.map((w) => w.id));

    if (!colorIds.has(option.defaultColorId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultColorId must be one of `colors`',
        path: ['defaultColorId'],
      });
    }
    if (!wheelIds.has(option.defaultWheelId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'defaultWheelId must be one of `wheels`',
        path: ['wheels'],
      });
    }

    // Every (color × wheel) combination must have a pre-baked still, or the
    // Tier-3 fallback would show a hole. This is the ADR-004 "must not drift"
    // contract enforced at the schema boundary.
    for (const color of option.colors) {
      for (const wheel of option.wheels) {
        const key = `${color.id}:${wheel.id}`;
        if (!(key in option.renderMatrix)) {
          ctx.addIssue({
            code: 'custom',
            message: `renderMatrix is missing the combination ${key}`,
            path: ['renderMatrix', key],
          });
        }
      }
    }
  });

export type ConfiguratorOption = z.infer<typeof configuratorOptionSchema>;

/** Build the canonical matrix key for a (colour, wheel) selection. */
export function renderMatrixKey(colorId: string, wheelId: string): string {
  return `${colorId}:${wheelId}`;
}
