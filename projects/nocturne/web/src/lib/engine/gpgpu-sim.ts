import {
  FloatType,
  HalfFloatType,
  type DataTexture,
  type Texture,
  type WebGLRenderer,
} from 'three';
import {
  GPUComputationRenderer,
  type Variable,
} from 'three/examples/jsm/misc/GPUComputationRenderer.js';

import { SIM_POSITION_GLSL } from '@/lib/glsl/sim-position.glsl';
import { SIM_VELOCITY_GLSL } from '@/lib/glsl/sim-velocity.glsl';
import {
  buildReference,
  seedPositionData,
  seedVelocityData,
  spawnShapeToFloat,
} from '@/lib/engine/particle-seed';
import type { Preset } from '@/lib/schemas';

/**
 * The GPGPU simulation wrapper (ADR-002 §1) — owns the `GPUComputationRenderer`,
 * its two ping-ponged variables (position + velocity), the half-float (→ full
 * float fallback) targets, and the per-frame uniform writes.
 *
 * Imperative class (not a hook) so its WebGL resources have an explicit, audited
 * lifecycle: `init()` allocates, `step()` runs one ping-pong, `dispose()` frees
 * the render targets (the reviewer's FBO-teardown item). The `reference`
 * attribute + seed textures are built ONCE here (the only per-particle CPU work).
 */

/** The mutable per-frame sim uniforms (ADR-002 §3, the audio-modulated base). */
export interface SimFrameUniforms {
  time: number;
  delta: number;
  flowScale: number;
  flowSpeed: number;
  turbulence: number; // base + bass surge
  damping: number;
  spread: number; // mid
  lifetime: number;
  domainScale: number;
  pointer: [number, number, number, number]; // xyz + strength
}

interface NumUniform {
  value: number;
}
interface Vec4Uniform {
  value: [number, number, number, number];
}

interface VelocityUniforms {
  uTime: NumUniform;
  uDelta: NumUniform;
  uFlowScale: NumUniform;
  uFlowSpeed: NumUniform;
  uTurbulence: NumUniform;
  uDamping: NumUniform;
  uSpread: NumUniform;
  uPointer: Vec4Uniform;
  uDomainScale: NumUniform;
}

interface PositionUniforms {
  uTime: NumUniform;
  uDelta: NumUniform;
  uFlowSpeed: NumUniform;
  uLifetime: NumUniform;
  uDomainScale: NumUniform;
  uSpawnShape: NumUniform;
}

export class GpgpuSim {
  readonly size: number;
  readonly reference: Float32Array;

  private gpu: GPUComputationRenderer | null = null;
  private positionVar: Variable | null = null;
  private velocityVar: Variable | null = null;
  private velUniforms: VelocityUniforms | null = null;
  private posUniforms: PositionUniforms | null = null;

  constructor(size: number) {
    this.size = size;
    this.reference = buildReference(size);
  }

  /**
   * Allocate the compute renderer + variables, seeded from the preset's spawn
   * shape / domain. Returns an error string on failure (e.g. no float targets),
   * mirroring `GPUComputationRenderer.init()`'s own contract — the caller routes
   * a non-null error to the poster (ADR-002 §1 hard gate). We do not crash.
   */
  init(renderer: WebGLRenderer, preset: Preset): string | null {
    const gpu = new GPUComputationRenderer(this.size, this.size, renderer);

    // half-float by default (the float-target extension is probed upstream by
    // detectGpuTier; if half-float targets are unrenderable, init() returns an
    // error and we route to the poster).
    gpu.setDataType(renderer.capabilities.isWebGL2 ? HalfFloatType : FloatType);

    const posTex = gpu.createTexture();
    const velTex = gpu.createTexture();
    this.fillTexture(
      posTex,
      seedPositionData(this.size, preset.particle.spawn, preset.flow.domainScale),
    );
    this.fillTexture(velTex, seedVelocityData(this.size));

    const velocityVar = gpu.addVariable(
      'textureVelocity',
      SIM_VELOCITY_GLSL,
      velTex,
    );
    const positionVar = gpu.addVariable(
      'texturePosition',
      SIM_POSITION_GLSL,
      posTex,
    );

    gpu.setVariableDependencies(velocityVar, [positionVar, velocityVar]);
    gpu.setVariableDependencies(positionVar, [positionVar, velocityVar]);

    const velUniforms: VelocityUniforms = {
      uTime: { value: 0 },
      uDelta: { value: 0 },
      uFlowScale: { value: preset.flow.scale },
      uFlowSpeed: { value: preset.flow.speed },
      uTurbulence: { value: preset.flow.turbulence },
      uDamping: { value: preset.flow.damping },
      uSpread: { value: 0 },
      uPointer: { value: [0, 0, 0, 0] },
      uDomainScale: { value: preset.flow.domainScale },
    };
    const posUniforms: PositionUniforms = {
      uTime: { value: 0 },
      uDelta: { value: 0 },
      uFlowSpeed: { value: preset.flow.speed },
      uLifetime: { value: preset.flow.lifetime },
      uDomainScale: { value: preset.flow.domainScale },
      uSpawnShape: { value: spawnShapeToFloat(preset.particle.spawn) },
    };
    // share the same uniform OBJECTS with the materials so the per-frame writes
    // below mutate what the shader reads.
    Object.assign(velocityVar.material.uniforms, velUniforms);
    Object.assign(positionVar.material.uniforms, posUniforms);

    const error = gpu.init();
    if (error !== null) {
      gpu.dispose();
      return error;
    }

    this.gpu = gpu;
    this.velocityVar = velocityVar;
    this.positionVar = positionVar;
    this.velUniforms = velUniforms;
    this.posUniforms = posUniforms;
    return null;
  }

  private fillTexture(target: DataTexture, data: Float32Array): void {
    (target.image.data as Float32Array).set(data);
    target.needsUpdate = true;
  }

  /** Run one ping-pong step with the current frame uniforms. */
  step(u: SimFrameUniforms): void {
    const gpu = this.gpu;
    const vu = this.velUniforms;
    const pu = this.posUniforms;
    if (!gpu || !vu || !pu) return;

    vu.uTime.value = u.time;
    vu.uDelta.value = u.delta;
    vu.uFlowScale.value = u.flowScale;
    vu.uFlowSpeed.value = u.flowSpeed;
    vu.uTurbulence.value = u.turbulence;
    vu.uDamping.value = u.damping;
    vu.uSpread.value = u.spread;
    vu.uPointer.value = u.pointer;
    vu.uDomainScale.value = u.domainScale;

    pu.uTime.value = u.time;
    pu.uDelta.value = u.delta;
    pu.uFlowSpeed.value = u.flowSpeed;
    pu.uLifetime.value = u.lifetime;
    pu.uDomainScale.value = u.domainScale;

    gpu.compute();
  }

  /** The current position texture for the render material (after a step). */
  get positionTexture(): Texture | null {
    if (!this.gpu || !this.positionVar) return null;
    return this.gpu.getCurrentRenderTarget(this.positionVar).texture;
  }

  /** The current velocity texture for the render material. */
  get velocityTexture(): Texture | null {
    if (!this.gpu || !this.velocityVar) return null;
    return this.gpu.getCurrentRenderTarget(this.velocityVar).texture;
  }

  /** Update the spawn shape for a preset switch (a discrete field). */
  setSpawnShape(shapeFloat: number): void {
    if (this.posUniforms) this.posUniforms.uSpawnShape.value = shapeFloat;
  }

  dispose(): void {
    this.gpu?.dispose();
    this.gpu = null;
    this.positionVar = null;
    this.velocityVar = null;
    this.velUniforms = null;
    this.posUniforms = null;
  }
}
