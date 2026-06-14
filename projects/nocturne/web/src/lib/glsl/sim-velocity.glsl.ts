import { NOISE_GLSL } from './noise.glsl';

/**
 * The simulation VELOCITY fragment shader (ADR-002 §1 — custom GLSL, the heart).
 *
 * Runs once per particle per frame in the GPGPU ping-pong. Reads the previous
 * `texturePosition` (xyz + age) and `textureVelocity` (xyz + seed), samples the
 * curl-noise flow at the particle's position, blends in the pointer attractor/
 * repeller and the audio turbulence, damps toward the new target, and writes the
 * new velocity. ZERO per-particle CPU work — all motion is here.
 *
 * `GPUComputationRenderer` prepends `uniform sampler2D texturePosition;` and
 * `uniform sampler2D textureVelocity;` (the dependency uniforms) and provides
 * `resolution`. We add the per-frame scalar/vector uniforms (ADR-002 §3).
 */
export const SIM_VELOCITY_GLSL = /* glsl */ `
${NOISE_GLSL}

uniform float uTime;
uniform float uDelta;
uniform float uFlowScale;
uniform float uFlowSpeed;
uniform float uTurbulence;   // base + bass surge (set on CPU = base + gain*bass)
uniform float uDamping;
uniform float uSpread;       // mid -> opens the flow outward
uniform vec4  uPointer;      // xyz world position, w = strength (0 when inactive)
uniform float uDomainScale;

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);

  vec3 p = pos.xyz;
  vec3 v = vel.xyz;

  // --- curl-noise advection (divergence-free swirling flow) ----------------
  vec3 flow = curlNoise(p * uFlowScale + vec3(0.0, 0.0, uTime * 0.05));
  // mid-band "spread" gently pushes the flow radially outward from the centre.
  vec3 radial = normalize(p + 1e-5) * uSpread;
  vec3 target = (flow * uTurbulence + radial) * uFlowSpeed;

  // --- pointer attractor / repeller leaving a wake in the velocity field ---
  if (uPointer.w != 0.0) {
    vec3 toPointer = uPointer.xyz - p;
    float d = length(toPointer) + 1e-4;
    float falloff = exp(-d * d * 1.6);
    // positive strength = attract, negative = repel.
    target += normalize(toPointer) * uPointer.w * falloff * 3.0;
  }

  // damp the velocity toward the target (frame-rate compensated lightly).
  float damp = clamp(uDamping, 0.0, 0.999);
  v = mix(target, v, damp);

  // soft containment: nudge back when drifting past the domain bounds so the
  // half-float precision domain stays bounded (ADR-002 §F1).
  float bound = uDomainScale;
  vec3 over = max(abs(p) - bound, 0.0);
  v -= sign(p) * over * 2.0;

  gl_FragColor = vec4(v, vel.w);
}
`;
