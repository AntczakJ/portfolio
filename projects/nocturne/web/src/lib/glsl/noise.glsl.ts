/**
 * Shared GLSL noise + curl chunk (ADR-001 / ADR-002 §1 — the hand-written craft).
 *
 * A 3D simplex noise (Ashima Arts / Stefan Gustavson, public domain) and a
 * finite-difference CURL of that noise's vector potential. Curl of a vector
 * field is divergence-free, so particles advected by it flow in smooth,
 * incompressible swirling streams rather than collapsing to sinks (ADR-002 §1).
 *
 * Exported as a string so it can be prepended to both the simulation velocity
 * shader and (for spawn hashing) the position shader. No `eval`, no WASM — the
 * GLSL compiles through the WebGL driver (ADR-002 §6, the CSP-clean guarantee).
 */
export const NOISE_GLSL = /* glsl */ `
// --- Ashima 3D simplex noise (public domain) -------------------------------
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(
     i.z+vec4(0.0,i1.z,i2.z,1.0))
   + i.y+vec4(0.0,i1.y,i2.y,1.0))
   + i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

// A 3D vector potential: three decorrelated noise samples (large offsets).
vec3 noisePotential(vec3 p){
  return vec3(
    snoise(p),
    snoise(p + vec3(31.416, 0.0, 0.0)),
    snoise(p - vec3(0.0, 47.853, 0.0))
  );
}

// Finite-difference curl of the potential — divergence-free flow (ADR-002 §1).
vec3 curlNoise(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  vec3 p_x0 = noisePotential(p - dx);
  vec3 p_x1 = noisePotential(p + dx);
  vec3 p_y0 = noisePotential(p - dy);
  vec3 p_y1 = noisePotential(p + dy);
  vec3 p_z0 = noisePotential(p - dz);
  vec3 p_z1 = noisePotential(p + dz);

  float x = (p_y1.z - p_y0.z) - (p_z1.y - p_z0.y);
  float y = (p_z1.x - p_z0.x) - (p_x1.z - p_x0.z);
  float z = (p_x1.y - p_x0.y) - (p_y1.x - p_y0.x);

  return vec3(x, y, z) / (2.0 * e);
}

// A cheap stable hash (for in-shader respawn position from a per-particle seed).
float hash11(float p){
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec3 hash33(vec3 p3){
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
`;
