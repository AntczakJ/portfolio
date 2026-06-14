import type { Page } from '@playwright/test';

/**
 * Deny WebGL before any app script runs, so `detectGpuTier()` (ADR-002 §4: the
 * WebGL2 + `EXT_color_buffer_float` hard gate) routes to the Tier-4 poster +
 * the real-DOM preset directory.
 *
 * Two flavours, both deterministic headless:
 *   - `denyWebgl`        — return null for any webgl/webgl2 context request
 *                          (simulates "no WebGL2 at all"). This is the strongest
 *                          floor.
 *   - `denyFloatBuffer`  — let WebGL2 acquire but make
 *                          `getExtension('EXT_color_buffer_float')` return null
 *                          (simulates a WebGL2-capable GPU that cannot render to
 *                          a float target — the GPGPU-specific hard gate that is
 *                          unique to this project vs apex's WebGL2-only gate).
 *
 * Must be installed via `page.addInitScript` BEFORE navigation so the stub is in
 * place when the after-mount capability probe runs.
 */
export async function denyWebgl(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // The real overloaded `getContext`, bound to the prototype so the stub can
    // forward non-WebGL requests without an unbound-method reference.
    const orig = HTMLCanvasElement.prototype.getContext.bind(
      HTMLCanvasElement.prototype,
    ) as (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) => RenderingContext | null;
    function patched(
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ): RenderingContext | null {
      if (
        type === 'webgl2' ||
        type === 'webgl' ||
        type === 'experimental-webgl'
      ) {
        return null;
      }
      return orig.call(this, type, ...args);
    }
    HTMLCanvasElement.prototype.getContext =
      patched as typeof HTMLCanvasElement.prototype.getContext;
  });
}

export async function denyFloatBuffer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const origGetContext = HTMLCanvasElement.prototype.getContext.bind(
      HTMLCanvasElement.prototype,
    ) as (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) => RenderingContext | null;
    function patched(
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ): RenderingContext | null {
      const ctx = origGetContext.call(this, type, ...args);
      if (
        ctx !== null &&
        (type === 'webgl2' || type === 'webgl') &&
        'getExtension' in ctx
      ) {
        // `'getExtension' in ctx` narrows to the WebGL context members; bind the
        // original so the stubbed forward is not an unbound-method reference.
        const origGetExt = ctx.getExtension.bind(ctx) as (
          name: string,
        ) => unknown;
        ctx.getExtension = ((name: string): unknown => {
          if (name === 'EXT_color_buffer_float') return null;
          return origGetExt(name);
        }) as typeof ctx.getExtension;
      }
      return ctx;
    }
    HTMLCanvasElement.prototype.getContext =
      patched as typeof HTMLCanvasElement.prototype.getContext;
  });
}
