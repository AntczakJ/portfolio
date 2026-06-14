/**
 * The render-particle shaders (ADR-002 §2 — THREE.Points, additive soft sprites).
 *
 * The vertex shader samples `texturePosition` / `textureVelocity` at the
 * once-built `reference` attribute (the particle's sim-UV), places `gl_Position`,
 * and sets `gl_PointSize` by base size × attenuation × the high-band sparkle.
 * The fragment shader draws a soft radial disc coloured by the preset palette
 * ramp (a 1D gradient texture) sampled by particle energy/speed, shifted by the
 * high band — additive-blended so the field glows cumulatively on the dark stage.
 */

export const RENDER_VERTEX_GLSL = /* glsl */ `
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float uParticleSize;
uniform float uSparkle;      // high band -> sparkle the point size
uniform float uColorShift;   // high band -> shift the palette sample
uniform float uPixelRatio;

attribute vec2 reference;

varying float vEnergy;
varying float vAge;

void main(){
  vec4 pos = texture2D(texturePosition, reference);
  vec4 vel = texture2D(textureVelocity, reference);

  float speed = length(vel.xyz);
  vEnergy = clamp(speed * 0.6 + uColorShift, 0.0, 1.0);
  vAge = pos.w;

  vec4 mvPosition = modelViewMatrix * vec4(pos.xyz, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // perspective size attenuation (keeps points small — a few px — so the
  // additive field glows cumulatively rather than blowing out to white) +
  // per-particle sparkle from the highs.
  float atten = 16.0 / max(-mvPosition.z, 0.1);
  float sparkle = 1.0 + uSparkle * 1.2;
  // fade in/out across the particle's life so respawns are seamless
  float lifeFade = smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.85, 1.0, vAge));
  gl_PointSize = clamp(uParticleSize * uPixelRatio * atten * sparkle * (0.4 + lifeFade), 0.0, 24.0);
}
`;

export const RENDER_FRAGMENT_GLSL = /* glsl */ `
precision highp float;

uniform sampler2D uPalette;  // 1D gradient ramp (low energy -> high)
uniform float uOpacity;
uniform float uEnergy;       // rms -> overall brightness lift

varying float vEnergy;
varying float vAge;

void main(){
  // soft additive radial disc (ADR-002 §2)
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float alpha = 1.0 - smoothstep(0.0, 0.5, d);
  alpha *= alpha; // sharper core, soft halo

  // colour from the palette ramp by particle energy
  float t = clamp(vEnergy, 0.0, 1.0);
  vec3 col = texture2D(uPalette, vec2(t, 0.5)).rgb;

  // life fade + rms brightness lift
  float lifeFade = smoothstep(0.0, 0.1, vAge) * (1.0 - smoothstep(0.8, 1.0, vAge));
  float brightness = (0.32 + uEnergy * 0.6);

  // The additive contribution is deliberately SMALL per particle so the field
  // builds a cumulative glow rather than clipping to white where hundreds of
  // sprites overlap (this preserves the palette colour — a hot core would wash
  // it out). AdditiveBlending = blendFunc(SRC_ALPHA, ONE), so the effective
  // contribution is col * brightness * (alpha * opacity * scale). The bloom
  // post (rms-pulsed) then lifts the bright cores into the glow.
  float a = alpha * uOpacity * lifeFade * 0.14;
  gl_FragColor = vec4(col * brightness, a);
}
`;
