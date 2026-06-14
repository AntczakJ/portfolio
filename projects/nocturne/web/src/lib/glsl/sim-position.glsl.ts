import { NOISE_GLSL } from './noise.glsl';

/**
 * The simulation POSITION fragment shader (ADR-002 §1).
 *
 * Integrates `position += velocity * dt * flowSpeed`, advances the age channel,
 * and RESPAWNS the particle (in-shader, from its stable seed) when its age
 * exceeds 1.0 or it drifts outside the field bounds — so the field continuously
 * regenerates and never drains into the curl attractors. No CPU per particle.
 *
 * The spawn shape is selected by `uSpawnShape` (0=sphere,1=box,2=shell,3=disc)
 * so a preset's spawn distribution is honoured on every respawn.
 */
export const SIM_POSITION_GLSL = /* glsl */ `
${NOISE_GLSL}

uniform float uTime;
uniform float uDelta;
uniform float uFlowSpeed;
uniform float uLifetime;
uniform float uDomainScale;
uniform float uSpawnShape; // 0 sphere, 1 box, 2 shell, 3 disc

// A fresh seeded spawn position in the preset's spawn shape, scaled to domain.
vec3 spawnPosition(vec3 seed){
  vec3 r = hash33(seed) * 2.0 - 1.0; // [-1,1]^3
  vec3 dir = normalize(r + 1e-5);
  float rad = uDomainScale;

  if (uSpawnShape < 0.5) {
    // sphere — uniform-ish within the ball
    float t = pow(hash11(seed.x + seed.y * 1.7), 0.3333);
    return dir * rad * t;
  } else if (uSpawnShape < 1.5) {
    // box
    return r * rad;
  } else if (uSpawnShape < 2.5) {
    // shell — on the sphere surface
    return dir * rad;
  } else {
    // disc — flattened on Y
    vec2 d2 = normalize(r.xz + 1e-5);
    float t = sqrt(hash11(seed.z + 3.1));
    return vec3(d2.x, r.y * 0.12, d2.y) * rad * t;
  }
}

void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);

  vec3 p = pos.xyz;
  float age = pos.w;
  float seedScalar = vel.w;

  // integrate
  float dt = clamp(uDelta, 0.0, 0.05); // clamp to avoid blowups on tab-return
  p += vel.xyz * dt * uFlowSpeed;
  age += dt / max(uLifetime, 0.5);

  // respawn on lifetime end or escape
  bool escaped = length(p) > uDomainScale * 1.8;
  if (age >= 1.0 || escaped) {
    vec3 seed = vec3(uv * 137.0, seedScalar * 53.0 + uTime);
    p = spawnPosition(seed);
    age = 0.0;
  }

  gl_FragColor = vec4(p, age);
}
`;
